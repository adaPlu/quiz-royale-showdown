import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { pool, type DbClient } from "./db.js";
import {
  availableGuestDisplayName,
  constantTimeSecretEqual,
  createQuizRoyaleApiServer,
  incrementGuestName,
} from "./server.js";

type LooseQuery = (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>;

test("protected user routes deny unauthenticated callers", async () => {
  await withMockPool(async (sql: string) => {
    if (sql.includes("auth_rate_limits")) return { rowCount: 1, rows: [{ count: "0" }] };
    throw new Error(`unexpected database query: ${sql}`);
  }, async () => {
    for (const route of [
      ["GET", "/friends"],
      ["POST", "/friends/add"],
      ["POST", "/friends/remove"],
      ["POST", "/presence/ping"],
      ["GET", "/users/search?q=al"],
    ] as const) {
      const response = await request(route[0], route[1], { body: route[0] === "POST" ? {} : undefined });
      assert.equal(response.status, 401, `${route[0]} ${route[1]} should require authentication`);
    }
  });
});

test("internal Railway routes require the shared internal token before work is accepted", async () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "correct-token";
  try {
    for (const route of [
      ["GET", "/auth/resolve"],
      ["GET", "/internal/guest/resolve"],
      ["POST", "/internal/guest/claim"],
      ["POST", "/internal/presence"],
      ["POST", "/internal/report"],
      ["POST", "/internal/questions/select"],
      ["POST", "/internal/questions/usage"],
      ["POST", "/internal/questions/generate"],
    ] as const) {
      const missing = await request(route[0], route[1], { body: route[0] === "POST" ? {} : undefined });
      assert.equal(missing.status, 401, `${route[0]} ${route[1]} should reject missing internal token`);

      const wrong = await request(route[0], route[1], {
        headers: { "X-Internal-Token": "wrong-token" },
        body: route[0] === "POST" ? {} : undefined,
      });
      assert.equal(wrong.status, 401, `${route[0]} ${route[1]} should reject wrong internal token`);
    }

    for (const route of [
      ["POST", "/internal/presence"],
      ["POST", "/internal/report"],
      ["POST", "/internal/questions/select"],
      ["POST", "/internal/questions/usage"],
      ["POST", "/internal/questions/generate"],
    ] as const) {
      const response = await request(route[0], route[1], {
        headers: { "X-Internal-Token": "correct-token" },
        body: {},
      });
      assert.equal(response.status, 400, `${route[0]} ${route[1]} should pass the token gate and validate the body`);
    }
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
});

test("internal token comparison accepts only exact shared secret", () => {
  assert.equal(constantTimeSecretEqual("correct-token", "correct-token"), true);
  assert.equal(constantTimeSecretEqual("wrong-token", "correct-token"), false);
  assert.equal(constantTimeSecretEqual("correct-token-extra", "correct-token"), false);
});

test("guest names keep incrementing beyond the first thousand active challengers", async () => {
  const taken = new Set<string>();
  for (let i = 1; i <= 1_000; i += 1) {
    taken.add(incrementGuestName("Challenger00", i).toLowerCase());
  }

  const db = {
    async query(sql: string, params?: unknown[]) {
      if (sql.includes("pg_advisory_xact_lock")) return { rowCount: 0, rows: [] };
      const candidate = String(params?.[1] ?? "").toLowerCase();
      return { rowCount: taken.has(candidate) ? 1 : 0, rows: taken.has(candidate) ? [{ exists: 1 }] : [] };
    },
  };

  assert.equal(await availableGuestDisplayName(db as unknown as DbClient, ""), "Challenger1001");
});

async function request(
  method: string,
  path: string,
  options: { headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: unknown }> {
  const server = createQuizRoyaleApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...options.headers,
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function withMockPool(
  query: LooseQuery,
  work: () => Promise<void>,
): Promise<void> {
  const target = pool as unknown as { query: LooseQuery };
  const original = target.query;
  target.query = query;
  try {
    await work();
  } finally {
    target.query = original;
  }
}
