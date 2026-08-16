import { createClient, type RedisClientType } from "redis";

let client: RedisClientType | null = null;
let disabled = false;

async function redis(): Promise<RedisClientType | null> {
  if (disabled || !process.env.REDIS_URL) return null;
  if (client?.isOpen) return client;
  try {
    client = createClient({ url: process.env.REDIS_URL });
    client.on("error", (error) => {
      disabled = true;
      console.warn("Redis disabled after error:", (error as Error).message);
    });
    await client.connect();
    return client;
  } catch (error) {
    disabled = true;
    console.warn("Redis unavailable; using Postgres fallback:", (error as Error).message);
    return null;
  }
}

export async function getJson<T>(key: string): Promise<T | null> {
  const r = await redis();
  if (!r) return null;
  const raw = await r.get(key).catch(() => null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const r = await redis();
  if (!r) return;
  await r.set(key, JSON.stringify(value), { EX: ttlSeconds }).catch(() => undefined);
}

export async function deleteKey(key: string): Promise<void> {
  const r = await redis();
  if (!r) return;
  await r.del(key).catch(() => undefined);
}

export async function deletePattern(pattern: string): Promise<void> {
  const r = await redis();
  if (!r) return;
  try {
    for await (const key of r.scanIterator({ MATCH: pattern, COUNT: 100 })) {
      await r.del(key).catch(() => undefined);
    }
  } catch (error) {
    disabled = true;
    console.warn("Redis pattern delete failed; using fallback:", (error as Error).message);
  }
}

export async function withRedisLock<T>(
  key: string,
  ttlSeconds: number,
  run: () => Promise<T>,
): Promise<T | null | undefined> {
  const r = await redis();
  if (!r) return undefined;
  const token = crypto.randomUUID();
  const locked = await r.set(key, token, { NX: true, EX: ttlSeconds }).catch(() => null);
  if (locked !== "OK") return null;
  try {
    return await run();
  } finally {
    const current = await r.get(key).catch(() => null);
    if (current === token) await r.del(key).catch(() => undefined);
  }
}

export async function closeCache(): Promise<void> {
  if (client?.isOpen) await client.quit().catch(() => undefined);
}

export function setRedisClientForTest(fakeClient: RedisClientType | null): void {
  client = fakeClient;
  disabled = false;
}
