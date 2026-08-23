import { sha256Hex } from "./auth-core";

export type RateLimitOptions = {
  max: number;
  windowMs: number;
};

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

export async function enforceRateLimit(
  ctx: DurableObjectState,
  request: Request,
  action: string,
  options: RateLimitOptions,
): Promise<Response | null> {
  const clientId = clientRateId(request);
  const key = `rl:${await sha256Hex(`${action}:${clientId}`)}`;
  const now = Date.now();
  let response: Response | null = null;

  await ctx.blockConcurrencyWhile(async () => {
    const current = await ctx.storage.get<RateLimitRecord>(key);
    const next =
      !current || current.resetAt <= now
        ? { count: 1, resetAt: now + options.windowMs }
        : { count: current.count + 1, resetAt: current.resetAt };

    await ctx.storage.put(key, next);

    if (next.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((next.resetAt - now) / 1000));
      response = Response.json(
        { error: "rate_limited", message: "Too many requests. Try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  });

  return response;
}

function clientRateId(request: Request): string {
  const cf = request.headers.get("CF-Connecting-IP")?.trim();
  if (cf) return cf;
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}
