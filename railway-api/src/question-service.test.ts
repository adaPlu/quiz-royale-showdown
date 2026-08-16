import assert from "node:assert/strict";
import test from "node:test";
import type { DbClient } from "./db.js";
import {
  advisoryLockParts,
  extractResponseOutputText,
  normalizeGeneratedQuestionForStorage,
  recordUsage,
  runWithQuestionGenerationLock,
  selectQuestionSet,
  upsertQuestions,
  type UsageReport,
} from "./question-service.js";
import { normalizeQuestionInput, type Difficulty, type QuestionRecord } from "./questions.js";

test("selector returns unique match questions with answers only for the room", async () => {
  const db = new FakeQuestionDb(makeRows());

  const selected = await selectQuestionSet(db as unknown as DbClient, 6);

  assert.equal(selected.length, 6);
  assert.equal(new Set(selected.map((question) => question.id)).size, 6);
  assert.equal(selected.filter((question) => question.difficulty === "easy").length, 2);
  assert.equal(selected.filter((question) => question.difficulty === "medium").length, 2);
  assert.equal(selected.filter((question) => question.difficulty === "hard").length, 2);
  assert.ok(selected.every((question) => Number.isInteger(question.correct)));
});

test("question upsert treats content-hash conflicts as duplicates", async () => {
  const rows = makeRecords("easy", 2);
  const db = {
    calls: 0,
    async query() {
      this.calls += 1;
      return { rowCount: this.calls === 1 ? 1 : 0, rows: this.calls === 1 ? [{ question_id: "q1" }] : [] };
    },
  };

  const result = await upsertQuestions(db as unknown as DbClient, rows);

  assert.deepEqual(result, { inserted: 1, duplicates: 1 });
});

test("usage reporting is idempotent and triggers one generation job per inserted bucket", async () => {
  const insertedEvents = [1, 0];
  const transactionClient = {
    async query(sql: string) {
      if (sql.includes("INSERT INTO question_usage_events")) {
        return { rowCount: insertedEvents.shift() ?? 0, rows: [] };
      }
      if (sql.includes("INSERT INTO question_usage_rollups")) {
        return { rowCount: 1, rows: [] };
      }
      throw new Error(`unexpected transaction query: ${sql}`);
    },
  };
  const db = {
    async query(sql: string) {
      if (sql.includes("count(*) FROM questions")) return { rowCount: 1, rows: [{ count: "0" }] };
      throw new Error(`unexpected db query: ${sql}`);
    },
  };
  const generations: Array<{ category: string; difficulty: Difficulty; count: number; reason: string }> = [];
  const report: UsageReport = {
    matchId: "match-1",
    mode: "QUICK",
    questions: [
      { roundNumber: 1, questionId: "q-1", category: "Science", difficulty: "easy", askedAt: 1_700_000_000_000 },
      { roundNumber: 1, questionId: "q-1", category: "Science", difficulty: "easy", askedAt: 1_700_000_000_000 },
    ],
  };

  const result = await recordUsage(report, {
    db: db as unknown as DbClient,
    matchSize: 2,
    transaction: async (work) => await work(transactionClient as unknown as DbClient),
    generate: async (category, difficulty, count, reason) => {
      generations.push({ category, difficulty, count, reason });
      return { jobId: "job-1", status: "completed", inserted: count, duplicates: 0 };
    },
  });

  assert.deepEqual(result, { inserted: 1, generationJobs: 1 });
  assert.deepEqual(generations, [{
    category: "Science",
    difficulty: "easy",
    count: 10,
    reason: "pool below 3x match size",
  }]);
});

test("OpenAI response text extractor supports SDK and raw REST shapes", () => {
  assert.equal(extractResponseOutputText({ output_text: "{\"questions\":[]}" }), "{\"questions\":[]}");
  assert.equal(
    extractResponseOutputText({
      output: [{
        type: "message",
        content: [{ type: "output_text", text: "{\"questions\":[1]}" }],
      }],
    }),
    "{\"questions\":[1]}",
  );
  assert.equal(extractResponseOutputText({ output: [] }), null);
});

test("generated duplicate-option questions are retained as pending review", () => {
  const question = normalizeGeneratedQuestionForStorage({
    category: "Science",
    difficulty: "easy",
    text: "Which generated option is duplicated here?",
    options: ["Same", "Same", "Different", "Another"],
    correctIndex: 0,
  }, "Science", "easy");

  assert.ok(question);
  assert.equal(question.status, "pending_review");
  assert.equal(question.source, "openai");
});

test("advisory lock parts are deterministic signed integers", () => {
  const first = advisoryLockParts("lock:question-generation:Science:easy");
  const second = advisoryLockParts("lock:question-generation:Science:easy");

  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.ok(first.every((part) => Number.isInteger(part)));
});

test("generation lock falls back to advisory lock when Redis is unavailable", async () => {
  let advisoryCalls = 0;
  const result = await runWithQuestionGenerationLock("Science", "easy", async () => "ran", {
    redisLock: async () => undefined,
    advisoryLock: async (_key, run) => {
      advisoryCalls += 1;
      return await run();
    },
  });

  assert.equal(result, "ran");
  assert.equal(advisoryCalls, 1);
});

test("generation lock returns null when Redis lock is busy", async () => {
  let advisoryCalls = 0;
  const result = await runWithQuestionGenerationLock("Science", "easy", async () => "ran", {
    redisLock: async () => null,
    advisoryLock: async (_key, run) => {
      advisoryCalls += 1;
      return await run();
    },
  });

  assert.equal(result, null);
  assert.equal(advisoryCalls, 0);
});

class FakeQuestionDb {
  constructor(private readonly rows: QuestionRecord[]) {}

  async query(_sql: string, params: unknown[]) {
    const difficulty = params[0] as Difficulty;
    return {
      rowCount: 0,
      rows: this.rows
        .filter((question) => question.difficulty === difficulty)
        .map((question) => ({
          question_id: question.questionId,
          category: question.category,
          difficulty: question.difficulty,
          text: question.text,
          options: question.options,
          correct_index: question.correct,
          content_hash: question.contentHash,
          source: question.source,
          status: question.status,
          created_at: question.createdAt,
          updated_at: question.updatedAt,
        })),
    };
  }
}

function makeRows(): QuestionRecord[] {
  return [
    ...makeRecords("easy", 3),
    ...makeRecords("medium", 3),
    ...makeRecords("hard", 3),
  ];
}

function makeRecords(difficulty: Difficulty, count: number): QuestionRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const question = normalizeQuestionInput({
      questionId: `${difficulty}-${index}`,
      category: "Science",
      difficulty,
      text: `Question ${difficulty} ${index} with enough words?`,
      options: [`A${index}`, `B${index}`, `C${index}`, `D${index}`],
      correctIndex: index % 4,
    }, "import", "active");
    assert.ok(question);
    return question;
  });
}
