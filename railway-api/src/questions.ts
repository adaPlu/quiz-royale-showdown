import { z } from "zod";
import { CATEGORIES } from "./categories.js";
import { sha256Hex } from "./auth-core.js";

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
export type Difficulty = typeof DIFFICULTIES[number];
export type QuestionStatus = "active" | "pending_review" | "rejected";
export type QuestionSource = "import" | "openai" | "static";

export type QuestionRecord = {
  questionId: string;
  category: string;
  difficulty: Difficulty;
  text: string;
  options: string[];
  correct: number;
  contentHash: string;
  source: QuestionSource;
  status: QuestionStatus;
  createdAt: number;
  updatedAt: number;
};

export type QuestionForMatch = Pick<
  QuestionRecord,
  "category" | "difficulty" | "text" | "options" | "correct"
> & { id: string };

export const questionInputSchema = z.object({
  id: z.string().trim().min(1).max(128).optional(),
  questionId: z.string().trim().min(1).max(128).optional(),
  category: z.string().trim().min(1).max(64),
  difficulty: z.enum(DIFFICULTIES),
  text: z.string().trim().min(8).max(240),
  options: z.array(z.string().trim().min(1).max(120)).length(4),
  correct: z.number().int().min(0).max(3).optional(),
  correctIndex: z.number().int().min(0).max(3).optional(),
});

export const generatedQuestionBatchSchema = z.object({
  questions: z.array(questionInputSchema).min(1).max(50),
});

export type QuestionInput = z.infer<typeof questionInputSchema>;

export function normalizeQuestionInput(
  raw: unknown,
  source: QuestionSource,
  status: QuestionStatus,
): QuestionRecord | null {
  const parsed = questionInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const input = parsed.data;
  const category = canonicalCategory(input.category);
  if (!category) return null;

  const options = input.options.map(normalizeText);
  if (new Set(options.map((option) => option.toLowerCase())).size !== options.length) return null;
  const correct = input.correctIndex ?? input.correct;
  if (correct === undefined || correct < 0 || correct >= options.length) return null;

  const text = normalizeText(input.text);
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
    source,
    status,
    createdAt: now,
    updatedAt: now,
  };
}

export function rowToQuestion(row: {
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
}): QuestionRecord {
  return {
    questionId: row.question_id,
    category: row.category,
    difficulty: row.difficulty,
    text: row.text,
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    correct: Number(row.correct_index),
    contentHash: row.content_hash,
    source: row.source,
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export function questionContentHash(
  category: string,
  difficulty: Difficulty,
  text: string,
  options: string[],
  correct: number,
): string {
  return sha256Hex(JSON.stringify({
    category: category.toLowerCase(),
    difficulty,
    text: normalizeText(text).toLowerCase(),
    options: options.map((option) => normalizeText(option).toLowerCase()),
    correct,
  }));
}

export function canonicalCategory(raw: string): string | null {
  const normalized = normalizeText(raw).toLowerCase();
  return CATEGORIES.find((category) => category.toLowerCase() === normalized) ?? null;
}

export function normalizeText(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim();
}

export function normalizeQuestionId(raw: string): string {
  return normalizeText(raw).replace(/[^A-Za-z0-9:_-]/g, "-").slice(0, 128);
}
