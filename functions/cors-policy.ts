export const DEFAULT_BROWSER_ORIGINS = [
  "https://quizroyale.gg",
  "https://www.quizroyale.gg",
  "https://play.quizroyale.gg",
  "https://quiz-royale-showdown.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
] as const;

const PAGES_PROJECT_HOST = "quiz-royale-showdown.pages.dev";

export type CorsConfig = {
  CORS_ORIGIN?: string;
  CORS_ORIGINS?: string;
};

export function allowedBrowserOrigins(config: CorsConfig = {}): Set<string> {
  const configured = [config.CORS_ORIGIN, config.CORS_ORIGINS]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  return new Set([...DEFAULT_BROWSER_ORIGINS, ...configured]);
}

export function isBrowserOriginAllowed(origin: string | null | undefined, config: CorsConfig = {}): boolean {
  if (!origin?.trim()) return true;
  const normalized = origin.trim().replace(/\/$/, "");
  if (allowedBrowserOrigins(config).has(normalized)) return true;
  try {
    const url = new URL(normalized);
    return url.protocol === "https:" && url.hostname.endsWith(`.${PAGES_PROJECT_HOST}`);
  } catch {
    return false;
  }
}
