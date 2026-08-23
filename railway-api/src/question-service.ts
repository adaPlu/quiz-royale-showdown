import { Pool } from "pg";
import { z } from "zod";
import { deleteKey, deletePattern, getJson, setJson, withRedisLock } from "./cache.js";
import { CATEGORIES } from "./categories.js";
import { pool, tx, type DbClient } from "./db.js";
import { postgresConnectionConfig } from "./runtime-config.js";
import {
  DIFFICULTIES,
  canonicalCategory,
  generatedQuestionBatchSchema,
  normalizeQuestionId,
  normalizeQuestionInput,
  normalizeText,
  questionContentHash,
  questionInputSchema,
  rowToQuestion,
  type Difficulty,
  type QuestionForMatch,
  type QuestionInput,
  type QuestionRecord,
  type QuestionSource,
  type QuestionStatus,
} from "./questions.js";

const QUESTION_POOL_TTL_SECONDS = 60;
const LEADERBOARD_CACHE_TTL_SECONDS = 15;
const MIN_POOL_MULTIPLIER = 3;
const TARGET_POOL_MULTIPLIER = 5;
const REUSE_THRESHOLD = 0.08;
const GENERATION_LOCK_SECONDS = 5 * 60;

export const selectQuestionsSchema = z.object({
  count: z.number().int().min(1).max(50),
  mode: z.string().trim().min(1).max(32).default("QUICK"),
});

export const usageReportSchema = z.object({
  matchId: z.string().trim().min(1).max(128),
  mode: z.string().trim().min(1).max(32),
  questions: z.array(z.object({
    roundNumber: z.number().int().positive(),
    questionId: z.string().trim().min(1).max(128),
    category: z.string().trim().min(1).max(64),
    difficulty: z.enum(DIFFICULTIES),
    askedAt: z.number().int().positive().optional(),
  })).min(1).max(50),
});

export const generateQuestionsSchema = z.object({
  category: z.string().trim().min(1).max(64),
  difficulty: z.enum(DIFFICULTIES),
  count: z.number().int().min(1).max(50),
  reason: z.string().trim().min(1).max(240).default("manual"),
});

export type UsageReport = z.infer<typeof usageReportSchema>;

type UsageRecordDeps = {
  db?: DbClient;
  transaction?: <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;
  generate?: typeof generateQuestions;
  matchSize?: number;
};

type QuestionGenerationLockDeps<T> = {
  redisLock?: (key: string, ttlSeconds: number, run: () => Promise<T>) => Promise<T | null | undefined>;
  advisoryLock?: (key: string, run: () => Promise<T>) => Promise<T | null>;
};

type QuestionRow = {
  question_id: string;
  category: string;
  difficulty: Difficulty;
  text: string;
  options: unknown;
  correct_index: number;
  content_hash: string;
  source: QuestionSource;
  status: QuestionStatus;
  created_at: string | number;
  updated_at: string | number;
};

type RepetitionCandidate = {
  category: string;
  difficulty: Difficulty;
  requestedCount: number;
  reason: string;
};

export async function selectQuestionSet(db: DbClient, count: number): Promise<QuestionForMatch[]> {
  const plan = difficultyPlan(count);
  const picked: QuestionForMatch[] = [];
  const used = new Set<string>();

  for (const [difficulty, needed] of Object.entries(plan) as [Difficulty, number][]) {
    for (const question of shuffle(await activeQuestions(db, difficulty))) {
      if (picked.length >= count || picked.filter((q) => q.difficulty === difficulty).length >= needed) break;
      if (used.has(question.questionId)) continue;
      used.add(question.questionId);
      picked.push(toMatchQuestion(question));
    }
  }

  if (picked.length < count) {
    for (const difficulty of DIFFICULTIES) {
      for (const question of shuffle(await activeQuestions(db, difficulty))) {
        if (picked.length >= count) break;
        if (used.has(question.questionId)) continue;
        used.add(question.questionId);
        picked.push(toMatchQuestion(question));
      }
    }
  }

  if (picked.length < count) {
    throw new Error(`not enough active questions: requested ${count}, selected ${picked.length}`);
  }

  return picked.slice(0, count);
}

export async function upsertQuestions(db: DbClient, records: QuestionRecord[]): Promise<{ inserted: number; duplicates: number }> {
  let inserted = 0;
  let duplicates = 0;
  for (const question of records) {
    const result = await db.query(
      `INSERT INTO questions(question_id, category, difficulty, text, options, correct_index, content_hash, source, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (content_hash) DO NOTHING
       RETURNING question_id`,
      [
        question.questionId,
        question.category,
        question.difficulty,
        question.text,
        JSON.stringify(question.options),
        question.correct,
        question.contentHash,
        question.source,
        question.status,
        question.createdAt,
        question.updatedAt,
      ],
    );
    if (result.rowCount) inserted += 1;
    else duplicates += 1;
  }
  if (inserted > 0) await invalidateQuestionCaches();
  return { inserted, duplicates };
}

export async function recordUsage(
  report: UsageReport,
  deps: UsageRecordDeps = {},
): Promise<{ inserted: number; generationJobs: number }> {
  const database = deps.db ?? pool;
  const transaction = deps.transaction ?? tx;
  const generate = deps.generate ?? generateQuestions;
  const insertedBuckets = new Set<string>();
  let inserted = 0;
  await transaction(async (client) => {
    for (const item of report.questions) {
      const askedAt = item.askedAt ?? Date.now();
      const result = await client.query(
        `INSERT INTO question_usage_events(match_id, round_number, question_id, mode, category, difficulty, asked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT DO NOTHING
         RETURNING question_id`,
        [report.matchId, item.roundNumber, item.questionId, report.mode, item.category, item.difficulty, askedAt],
      );
      if (!result.rowCount) continue;
      inserted += 1;
      insertedBuckets.add(bucketKey(item.category, item.difficulty));
      await updateUsageRollups(client, item.questionId, item.category, item.difficulty, askedAt);
    }
  });

  let generationJobs = 0;
  for (const key of insertedBuckets) {
    const [category, difficulty] = key.split("|") as [string, Difficulty];
    const candidate = await repetitionCandidate(database, category, difficulty, deps.matchSize ?? 10);
    if (!candidate) continue;
    const job = await generate(candidate.category, candidate.difficulty, candidate.requestedCount, candidate.reason);
    if (job.status !== "skipped") generationJobs += 1;
  }
  return { inserted, generationJobs };
}

export async function generateQuestions(
  category: string,
  difficulty: Difficulty,
  requestedCount: number,
  reason: string,
): Promise<{ jobId: string; status: "completed" | "failed" | "skipped"; inserted: number; duplicates: number; error?: string }> {
  if (!CATEGORIES.includes(category)) {
    return { jobId: "", status: "skipped", inserted: 0, duplicates: 0, error: "unknown_category" };
  }
  if (!process.env.OPENAI_API_KEY) {
    const jobId = await writeGenerationJob(category, difficulty, requestedCount, "skipped", reason, "OPENAI_API_KEY is not configured");
    return { jobId, status: "skipped", inserted: 0, duplicates: 0, error: "OPENAI_API_KEY is not configured" };
  }

  const result = await runWithQuestionGenerationLock(category, difficulty, async () => {
    const jobId = await writeGenerationJob(category, difficulty, requestedCount, "running", reason, null);
    try {
      const generated = await callOpenAiForQuestions(category, difficulty, requestedCount);
      const normalized = generated.questions
        .map((question) => normalizeGeneratedQuestionForStorage(question, category, difficulty))
        .filter((question): question is QuestionRecord => Boolean(question));
      const save = await upsertQuestions(pool, normalized);
      await writeGenerationJob(category, difficulty, requestedCount, "completed", reason, null, jobId);
      return { jobId, status: "completed" as const, inserted: save.inserted, duplicates: save.duplicates };
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      await writeGenerationJob(category, difficulty, requestedCount, "failed", reason, message, jobId);
      return { jobId, status: "failed" as const, inserted: 0, duplicates: 0, error: message };
    }
  });
  return result ?? { jobId: "", status: "skipped", inserted: 0, duplicates: 0, error: "generation already running" };
}

export function normalizeGeneratedQuestionForStorage(
  raw: unknown,
  requestedCategory: string,
  requestedDifficulty: Difficulty,
): QuestionRecord | null {
  const parsed = questionInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const input = parsed.data satisfies QuestionInput;
  const category = canonicalCategory(input.category);
  if (!category) return null;
  const options = input.options.map(normalizeText);
  const text = normalizeText(input.text);
  const correct = input.correctIndex ?? input.correct;
  if (correct === undefined || correct < 0 || correct >= options.length) return null;

  const hasDuplicateOptions = new Set(options.map((option) => option.toLowerCase())).size !== options.length;
  const status: QuestionStatus =
    category === requestedCategory && input.difficulty === requestedDifficulty && !hasDuplicateOptions
      ? "active"
      : "pending_review";
  const contentHash = questionContentHash(category, input.difficulty, text, options, correct);
  const now = Date.now();
  return {
    questionId: normalizeQuestionId(input.questionId ?? input.id ?? `q-${contentHash.slice(0, 16)}`),
    category,
    difficulty: input.difficulty,
    text,
    options,
    correct,
    contentHash,
    source: "openai",
    status,
    createdAt: now,
    updatedAt: now,
  };
}

export async function runWithQuestionGenerationLock<T>(
  category: string,
  difficulty: Difficulty,
  run: () => Promise<T>,
  deps: QuestionGenerationLockDeps<T> = {},
): Promise<T | null> {
  const lockKey = `lock:question-generation:${category}:${difficulty}`;
  const redisLock = deps.redisLock ?? withRedisLock;
  const advisoryLock = deps.advisoryLock ?? withPostgresAdvisoryLock;
  const redisResult = await redisLock(lockKey, GENERATION_LOCK_SECONDS, run);
  if (redisResult !== undefined) return redisResult;
  return await advisoryLock(lockKey, run);
}

async function withPostgresAdvisoryLock<T>(key: string, run: () => Promise<T>): Promise<T | null> {
  const [a, b] = advisoryLockParts(key);
  const client = await pool.connect();
  let locked = false;
  try {
    const result = await client.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1, $2) AS locked", [a, b]);
    locked = Boolean(result.rows[0]?.locked);
    if (!locked) return null;
    return await run();
  } finally {
    if (locked) await client.query("SELECT pg_advisory_unlock($1, $2)", [a, b]).catch(() => undefined);
    client.release();
  }
}

export function advisoryLockParts(key: string): [number, number] {
  const digest = Buffer.from(questionContentHash("Science", "easy", key, [key, "lock", "generation", "railway"], 0), "hex");
  return [digest.readInt32BE(0), digest.readInt32BE(4)];
}

export async function cachedLeaderboard<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = await getJson<T>(`leaderboard:${key}`);
  if (cached) return cached;
  const fresh = await load();
  await setJson(`leaderboard:${key}`, fresh, LEADERBOARD_CACHE_TTL_SECONDS);
  return fresh;
}

export async function invalidateLeaderboardCaches(): Promise<void> {
  await deletePattern("leaderboard:*");
}

export async function invalidateQuestionCaches(): Promise<void> {
  for (const difficulty of DIFFICULTIES) await deleteKey(questionPoolKey(difficulty));
}

async function activeQuestions(db: DbClient, difficulty: Difficulty): Promise<QuestionRecord[]> {
  const key = questionPoolKey(difficulty);
  const cached = await getJson<QuestionRecord[]>(key);
  if (cached) return cached;
  const rows = await db.query<QuestionRow>(
    `SELECT * FROM questions
     WHERE status = 'active' AND difficulty = $1
     ORDER BY updated_at ASC`,
    [difficulty],
  );
  const questions = rows.rows.map(rowToQuestion);
  await setJson(key, questions, QUESTION_POOL_TTL_SECONDS);
  return questions;
}

async function repetitionCandidate(
  db: DbClient,
  category: string,
  difficulty: Difficulty,
  matchSize: number,
): Promise<RepetitionCandidate | null> {
  const active = await db.query<{ count: string }>(
    "SELECT count(*) FROM questions WHERE status = 'active' AND category = $1 AND difficulty = $2",
    [category, difficulty],
  );
  const poolSize = Number(active.rows[0]?.count ?? 0);
  const minPool = matchSize * MIN_POOL_MULTIPLIER;
  if (poolSize < minPool) {
    return {
      category,
      difficulty,
      requestedCount: Math.min(50, Math.max(1, matchSize * TARGET_POOL_MULTIPLIER - poolSize)),
      reason: `pool below ${MIN_POOL_MULTIPLIER}x match size`,
    };
  }

  const since = Date.now() - 24 * 60 * 60 * 1000;
  const recent = await db.query<{ total: string; top_count: string }>(
    `WITH bucket AS (
       SELECT question_id, count(*)::int AS asked_count
       FROM question_usage_events
       WHERE category = $1 AND difficulty = $2 AND asked_at >= $3
       GROUP BY question_id
     )
     SELECT COALESCE(sum(asked_count), 0)::text AS total,
            COALESCE(max(asked_count), 0)::text AS top_count
     FROM bucket`,
    [category, difficulty, since],
  );
  const total = Number(recent.rows[0]?.total ?? 0);
  const top = Number(recent.rows[0]?.top_count ?? 0);
  if (total >= 25 && top / total > REUSE_THRESHOLD) {
    return {
      category,
      difficulty,
      requestedCount: Math.min(50, Math.max(5, matchSize * TARGET_POOL_MULTIPLIER - poolSize)),
      reason: `top question reuse ${(top / total).toFixed(3)} exceeded ${REUSE_THRESHOLD}`,
    };
  }
  return null;
}

async function updateUsageRollups(
  db: DbClient,
  questionId: string,
  category: string,
  difficulty: Difficulty,
  askedAt: number,
): Promise<void> {
  const windows = [
    ["1h", 60 * 60 * 1000],
    ["24h", 24 * 60 * 60 * 1000],
    ["7d", 7 * 24 * 60 * 60 * 1000],
  ] as const;
  for (const [name, span] of windows) {
    const started = Math.floor(askedAt / span) * span;
    await db.query(
      `INSERT INTO question_usage_rollups(window_name, category, difficulty, question_id, asked_count, window_started_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6)
       ON CONFLICT (window_name, category, difficulty, question_id, window_started_at)
       DO UPDATE SET asked_count = question_usage_rollups.asked_count + 1, updated_at = EXCLUDED.updated_at`,
      [name, category, difficulty, questionId, started, Date.now()],
    );
  }
}

async function writeGenerationJob(
  category: string,
  difficulty: Difficulty,
  requestedCount: number,
  status: "running" | "completed" | "failed" | "skipped",
  reason: string,
  error: string | null,
  existingJobId?: string,
): Promise<string> {
  const jobId = existingJobId ?? `qgen-${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO question_generation_jobs(job_id, category, difficulty, requested_count, status, reason, error, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (job_id)
     DO UPDATE SET status = EXCLUDED.status, error = EXCLUDED.error, updated_at = EXCLUDED.updated_at`,
    [jobId, category, difficulty, requestedCount, status, reason, error, Date.now()],
  );
  return jobId;
}

async function callOpenAiForQuestions(
  category: string,
  difficulty: Difficulty,
  count: number,
): Promise<z.infer<typeof generatedQuestionBatchSchema>> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_QUESTION_MODEL ?? "gpt-5-mini",
      input: [
        {
          role: "system",
          content: "Generate factual, family-friendly multiple-choice trivia. Avoid trick questions, ambiguous answers, and duplicate options.",
        },
        {
          role: "user",
          content: `Create ${count} ${difficulty} Quiz Royale questions for category ${category}. Each question needs exactly four options and one correctIndex.`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "quiz_royale_question_batch",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["questions"],
            properties: {
              questions: {
                type: "array",
                minItems: 1,
                maxItems: 50,
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["category", "difficulty", "text", "options", "correctIndex"],
                  properties: {
                    category: { type: "string", enum: CATEGORIES },
                    difficulty: { type: "string", enum: DIFFICULTIES },
                    text: { type: "string", minLength: 8, maxLength: 240 },
                    options: {
                      type: "array",
                      minItems: 4,
                      maxItems: 4,
                      items: { type: "string", minLength: 1, maxLength: 120 },
                    },
                    correctIndex: { type: "integer", minimum: 0, maximum: 3 },
                  },
                },
              },
            },
          },
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI returned ${response.status}`);
  const raw = await response.json();
  const text = extractResponseOutputText(raw);
  if (!text) throw new Error("OpenAI response did not include text output");
  return generatedQuestionBatchSchema.parse(JSON.parse(text));
}

export function extractResponseOutputText(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const direct = (raw as { output_text?: unknown }).output_text;
  if (typeof direct === "string" && direct.trim()) return direct;
  const output = (raw as { output?: unknown }).output;
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    const text = content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        const value = (part as { text?: unknown }).text;
        return typeof value === "string" ? value : "";
      })
      .join("")
      .trim();
    if (text) return text;
  }
  return null;
}

function difficultyPlan(count: number): Record<Difficulty, number> {
  const easy = Math.max(1, Math.round(count * 0.3));
  const hard = Math.max(1, Math.round(count * 0.35));
  return { easy, medium: Math.max(0, count - easy - hard), hard };
}

function toMatchQuestion(question: QuestionRecord): QuestionForMatch {
  return {
    id: question.questionId,
    category: question.category,
    difficulty: question.difficulty,
    text: question.text,
    options: question.options,
    correct: question.correct,
  };
}

function questionPoolKey(difficulty: Difficulty): string {
  return `questions:active:${difficulty}`;
}

function bucketKey(category: string, difficulty: Difficulty): string {
  return `${category}|${difficulty}`;
}

function shuffle<T>(input: T[]): T[] {
  const arr = [...input];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i]!;
    const b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

export async function importQuestionsFromSource(): Promise<{ scanned: number; inserted: number; duplicates: number }> {
  const sourceUrl = process.env.QUESTION_SOURCE_DATABASE_URL;
  if (!sourceUrl) throw new Error("QUESTION_SOURCE_DATABASE_URL is required");
  const source = new Pool(
    postgresConnectionConfig(process.env, {
      urlKey: "QUESTION_SOURCE_DATABASE_URL",
      modeKey: "QUESTION_SOURCE_PGSSL",
    }),
  );
  try {
    const rows = await source.query("SELECT * FROM questions");
    const records = rows.rows
      .map((row) => normalizeQuestionInput(sourceRowToInput(row), "import", "active"))
      .filter((question): question is QuestionRecord => Boolean(question));
    const result = await upsertQuestions(pool, records);
    return { scanned: rows.rowCount ?? 0, ...result };
  } finally {
    await source.end();
  }
}

function sourceRowToInput(row: Record<string, unknown>): Record<string, unknown> {
  return {
    questionId: row.question_id ?? row.id,
    category: row.category,
    difficulty: row.difficulty,
    text: row.text ?? row.prompt ?? row.question,
    options: row.options ?? row.answers,
    correctIndex: row.correct_index ?? row.correctIndex ?? row.correct,
  };
}
