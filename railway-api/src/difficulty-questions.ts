import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pool, type DbClient } from "./db.js";
import { DIFFICULTIES, type Difficulty, type QuestionForMatch } from "./questions.js";

const requestSchema = z.object({
  count: z.number().int().min(1).max(50),
  mode: z.string().trim().min(1).max(32).default("QUICK"),
  difficulty: z.enum(DIFFICULTIES),
});

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
};

export async function selectDifficultyQuestions(
  db: Pick<DbClient, "query">,
  difficulty: Difficulty,
  count: number,
): Promise<QuestionForMatch[]> {
  const result = await db.query<QuestionBankRow>(
    `SELECT id, prompt, "optionA", "optionB", "optionC", "optionD", "correctIndex",
            category, difficulty::text AS difficulty
     FROM "QuestionBank"
     WHERE "isActive" = true AND lower(difficulty::text) = $1
     ORDER BY "lastUsedAt" ASC NULLS FIRST, random()
     LIMIT $2`,
    [difficulty, count],
  );

  const questions = result.rows
    .map((row): QuestionForMatch | null => {
      const normalizedDifficulty = row.difficulty.toLowerCase();
      const options = [row.optionA, row.optionB, row.optionC, row.optionD].map((value) => value.trim());
      const correct = Number(row.correctIndex);
      if (normalizedDifficulty !== difficulty || options.some((value) => !value)) return null;
      if (!Number.isInteger(correct) || correct < 0 || correct >= options.length) return null;
      if (!row.prompt.trim() || !row.id.trim()) return null;
      return {
        id: row.id.trim(),
        category: row.category.trim(),
        difficulty,
        text: row.prompt.trim(),
        options,
        correct,
      };
    })
    .filter((question): question is QuestionForMatch => Boolean(question));

  if (questions.length < count) {
    throw new Error(`not enough active ${difficulty} questions: requested ${count}, selected ${questions.length}`);
  }
  return questions;
}

export async function handleDifficultyQuestionRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<boolean> {
  const url = request.url?.split("?", 1)[0] ?? "";
  if (url !== "/internal/questions/select-difficulty") return false;

  if (request.method !== "POST") {
    send(response, 405, { error: "method_not_allowed" });
    return true;
  }
  if (!authorizedInternal(request)) {
    send(response, 401, { error: "unauthorized" });
    return true;
  }

  const parsed = requestSchema.safeParse(await readJson(request).catch(() => null));
  if (!parsed.success) {
    send(response, 400, { error: "bad_request" });
    return true;
  }

  try {
    const questions = await selectDifficultyQuestions(pool, parsed.data.difficulty, parsed.data.count);
    send(response, 200, { questions });
  } catch (error) {
    send(response, 503, { error: "question_pool_unavailable", message: (error as Error).message });
  }
  return true;
}

function authorizedInternal(request: http.IncomingMessage): boolean {
  const expected = process.env.INTERNAL_API_TOKEN?.trim();
  const suppliedHeader = request.headers["x-internal-token"];
  const supplied = (Array.isArray(suppliedHeader) ? suppliedHeader[0] : suppliedHeader)?.trim();
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32 * 1024) throw new Error("payload_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}
