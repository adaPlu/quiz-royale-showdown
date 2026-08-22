import type { MatchOutcome } from "./identity";
import type { GameMode } from "./protocol";
import type { Question } from "./questions";

export type RailwayEnv = {
  RAILWAY_API_URL?: string;
  RAILWAY_INTERNAL_TOKEN?: string;
};

export async function callRailway(
  env: RailwayEnv,
  path: string,
  init?: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> },
): Promise<Response | null> {
  if (!env.RAILWAY_API_URL) return null;
  const base = env.RAILWAY_API_URL.replace(/\/+$/, "");
  const headers = new Headers();
  headers.set("Accept", "application/json");
  if (init?.body !== undefined) headers.set("Content-Type", "application/json");
  for (const [key, value] of Object.entries(init?.headers ?? {})) headers.set(key, value);
  if (init?.token) headers.set("Authorization", `Bearer ${init.token}`);
  if (env.RAILWAY_INTERNAL_TOKEN) headers.set("X-Internal-Token", env.RAILWAY_INTERNAL_TOKEN);

  return fetch(`${base}${path}`, {
    method: init?.method ?? (init?.body === undefined ? "GET" : "POST"),
    headers,
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

export async function callRailwayJson<T>(
  env: RailwayEnv,
  path: string,
  init?: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> },
): Promise<T | null> {
  const response = await callRailway(env, path, init).catch(() => null);
  if (!response?.ok) return null;
  return (await response.json()) as T;
}

export async function reportOutcomeToRailway(
  env: RailwayEnv,
  outcome: MatchOutcome,
): Promise<Response | null> {
  return await callRailway(env, "/internal/report", { method: "POST", body: { outcome } });
}

export async function selectQuestionsFromRailway(
  env: RailwayEnv,
  mode: GameMode,
  count: number,
): Promise<Question[] | null> {
  const response = await callRailwayJson<{ questions: Question[] }>(
    env,
    "/internal/questions/select",
    { method: "POST", body: { mode, count } },
  );
  return response?.questions ?? null;
}

export type QuestionUsageItem = {
  roundNumber: number;
  questionId: string;
  category: string;
  difficulty: string;
  askedAt: number;
};

export async function reportQuestionUsageToRailway(
  env: RailwayEnv,
  matchId: string,
  mode: GameMode,
  questions: QuestionUsageItem[],
): Promise<Response | null> {
  return await callRailway(env, "/internal/questions/usage", {
    method: "POST",
    body: { matchId, mode, questions },
  });
}
