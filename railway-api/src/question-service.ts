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
  type Difficulty,
  type QuestionForMatch,
  type QuestionInput,
  type QuestionRecord,
  type QuestionStatus,
} from "./questions.js";

const QUESTION_POOL_TTL_SECONDS = 60;
const LEADERBOARD_CACHE_TTL_SECONDS = 15;
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
  transaction?: <T>(work: (client: DbClient) => Promise<T>) => Promise<T>;
};

type QuestionGenerationLockDeps<T> = {
  redisLock?: (key: string, ttlSeconds: number, run: () => Promise<T>) => Promise<T | null | undefined>;
  advisoryLock?: (key: string, run: () => Promise<T>) => Promise<T | null>;
};

type QuestionBankRow = {
  id: string;
  prompt: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  correctIndex: number;
  category: string;
  difficulty: string;
  lastUsedAt: string | Date | null;
  isActive: boolean;
  createdAt: string | Date | null;
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
      `INSERT INTO "QuestionBank"(id, prompt, "optionA", "optionB", "optionC", "optionD", "correctIndex",
                                  category, difficulty, "lastUsedAt", "isActive", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, upper($9)::"Difficulty", NULL, $10, to_timestamp($11 / 1000.0))
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        question.questionId,
        question.text,
        question.options[0],
        question.options[1],
        question.options[2],
        question.options[3],
        question.correct,
        question.category,
        question.difficulty,
        question.status === "active",
        question.createdAt,
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
  const transaction = deps.transaction ?? tx;
  let inserted = 0;
  const seen = new Set<string>();
  await transaction(async (client) => {
    for (const item of report.questions) {
      if (seen.has(item.questionId)) continue;
      seen.add(item.questionId);
      const askedAt = item.askedAt ?? Date.now();
      const result = await client.query(
        `UPDATE "QuestionBank"
         SET "lastUsedAt" = to_timestamp($2 / 1000.0)
         WHERE id = $1`,
        [item.questionId, askedAt],
      );
      inserted += result.rowCount ?? 0;
    }
  });

  if (inserted > 0) await invalidateQuestionCaches();
  return { inserted, generationJobs: 0 };
}

export async function generateQuestions(
  category: string,
  difficulty: Difficulty,
  requestedCount: number,
  reason: string,
): Promise<{ jobId: string; status: "completed" | "failed" | "skipped"; inserted: number; duplicates: number; error?: string }> {
  const jobId = `qgen-${crypto.randomUUID()}`;
  if (!CATEGORIES.includes(category)) {
    return { jobId, status: "skipped", inserted: 0, duplicates: 0, error: "unknown_category" };
  }
  if (!process.env.OPENAI_API_KEY) {
    return { jobId, status: "skipped", inserted: 0, duplicates: 0, error: "OPENAI_API_KEY is not configured" };
  }

  const result = await runWithQuestionGenerationLock(category, difficulty, async () => {
    try {
      const generated = await callOpenAiForQuestions(category, difficulty, requestedCount);
      const normalized = generated.questions
        .map((question) => normalizeGeneratedQuestionForStorage(question, category, difficulty))
        .filter((question): question is QuestionRecord => Boolean(question));
      const save = await upsertQuestions(pool, normalized);
      return { jobId, status: "completed" as const, inserted: save.inserted, duplicates: save.duplicates };
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      return { jobId, status: "failed" as const, inserted: 0, duplicates: 0, error: message };
    }
  });
  return result ?? { jobId, status: "skipped", inserted: 0, duplicates: 0, error: "generation already running" };
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
  if (cached?.length) return cached;
  const questionBankRows = await activeQuestionBankQuestions(db, difficulty);
  if (questionBankRows.length > 0) {
    await setJson(key, questionBankRows, QUESTION_POOL_TTL_SECONDS);
    return questionBankRows;
  }
  return [];
}

async function activeQuestionBankQuestions(db: DbClient, difficulty: Difficulty): Promise<QuestionRecord[]> {
  try {
    const rows = await db.query<QuestionBankRow>(
      `SELECT id, prompt, "optionA", "optionB", "optionC", "optionD", "correctIndex",
              category, difficulty::text AS difficulty, "lastUsedAt", "isActive", "createdAt"
       FROM "QuestionBank"
       WHERE "isActive" = true AND lower(difficulty::text) = $1
       ORDER BY "lastUsedAt" ASC NULLS FIRST, "createdAt" ASC`,
      [difficulty],
    );
    return rows.rows.map(rowToQuestionBankQuestion).filter((question): question is QuestionRecord => Boolean(question));
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}

function rowToQuestionBankQuestion(row: QuestionBankRow): QuestionRecord | null {
  const difficulty = row.difficulty.toLowerCase();
  if (!DIFFICULTIES.includes(difficulty as Difficulty)) return null;
  const options = [row.optionA, row.optionB, row.optionC, row.optionD].map(normalizeText);
  if (options.some((option) => option.length === 0)) return null;
  const correct = Number(row.correctIndex);
  if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) return null;
  const text = normalizeText(row.prompt);
  if (text.length < 8) return null;
  const questionId = normalizeQuestionId(row.id);
  const createdAt = timestampToMs(row.createdAt) ?? Date.now();
  const updatedAt = timestampToMs(row.lastUsedAt) ?? createdAt;
  return {
    questionId,
    category: normalizeText(row.category),
    difficulty: difficulty as Difficulty,
    text,
    options,
    correct,
    contentHash: `questionbank:${questionId}`,
    source: "import",
    status: "active",
    createdAt,
    updatedAt,
  };
}

function timestampToMs(value: string | Date | null): number | null {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isMissingTableError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "42P01";
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
