// functions/do-dispatch.ts — one place that knows how to address a Durable
// Object on this platform, so callers never hand-roll the routing headers.

export type DoFetcher = Fetcher & {
  setAlarm?(className: string, id: string, scheduledTime: number | Date): Promise<void>;
  getAlarm?(className: string, id: string): Promise<number | null>;
  deleteAlarm?(className: string, id: string): Promise<void>;
};

export type DoClassName = "MatchRoom" | "Matchmaker" | "UserDirectory" | "GuestRegistry" | "Leaderboard";

export type DoEnv = {
  DO?: DoFetcher;
  MATCH_ROOM?: DurableObjectNamespace;
  MATCHMAKER?: DurableObjectNamespace;
  USER_DIRECTORY?: DurableObjectNamespace;
  GUEST_REGISTRY?: DurableObjectNamespace;
  LEADERBOARD?: DurableObjectNamespace;
  PASSWORD_RESET_BASE_URL?: string;
  PASSWORD_RESET_EMAIL_ENDPOINT?: string;
  PASSWORD_RESET_EMAIL_TOKEN?: string;
  PASSWORD_RESET_FROM?: string;
  GOOGLE_PLAY_REVIEW_EMAIL?: string;
  GOOGLE_PLAY_REVIEW_USERNAME?: string;
  GOOGLE_PLAY_REVIEW_PASSWORD?: string;
  MATCH_ROOM_TICKET_SECRET?: string;
  RAILWAY_API_URL?: string;
  RAILWAY_INTERNAL_TOKEN?: string;
  ALLOW_STATIC_QUESTIONS_FALLBACK?: string;
};

/** Singleton instance names for the stores that have exactly one shard. */
export const USER_DIRECTORY_ID = "main";
export const GUEST_REGISTRY_ID = "main";
export const LEADERBOARD_ID = "main";

const DO_BINDING_BY_CLASS: Record<DoClassName, keyof DoEnv> = {
  MatchRoom: "MATCH_ROOM",
  Matchmaker: "MATCHMAKER",
  UserDirectory: "USER_DIRECTORY",
  GuestRegistry: "GUEST_REGISTRY",
  Leaderboard: "LEADERBOARD",
};

/**
 * Calls a Durable Object by class + instance name. [path] is a plain pathname
 * (e.g. `/internal/report`); the origin is irrelevant to the DO but must be a
 * valid absolute URL for `Request`.
 */
export async function callDo(
  env: DoEnv,
  className: DoClassName,
  id: string,
  path: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> },
): Promise<Response> {
  const headers = new Headers(init?.headers ?? {});
  headers.set("X-Rork-DO-Class", className);
  headers.set("X-Rork-DO-Id", id);

  const hasBody = init?.body !== undefined;
  if (hasBody) headers.set("Content-Type", "application/json");

  return dispatchDurableObject(
    env,
    className,
    id,
    new Request(`https://do.internal${path}`, {
      method: init?.method ?? (hasBody ? "POST" : "GET"),
      headers,
      body: hasBody ? JSON.stringify(init?.body) : undefined,
    }),
  );
}

export function dispatchDurableObject(
  env: DoEnv,
  className: DoClassName,
  id: string,
  request: Request,
): Promise<Response> {
  if (typeof env.DO?.fetch === "function") {
    return env.DO.fetch(request);
  }

  const namespace = env[DO_BINDING_BY_CLASS[className]] as DurableObjectNamespace | undefined;
  if (!namespace) throw new Error(`missing durable object binding for ${className}`);

  return namespace.get(namespace.idFromName(id)).fetch(request);
}

/** Calls a DO and decodes JSON, returning null on any non-2xx or parse failure. */
export async function callDoJson<T>(
  env: DoEnv,
  className: DoClassName,
  id: string,
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T | null> {
  try {
    const response = await callDo(env, className, id, path, init);
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  }
}
