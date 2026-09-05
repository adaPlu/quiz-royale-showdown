import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { pool } from "./db.js";
import { createQuizRoyaleApiServer } from "./server.js";

type LooseQuery = (sql: string, params?: unknown[]) => Promise<{ rowCount: number; rows: Record<string, unknown>[] }>;

test("economy report route requires the internal token", async () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "correct-token";
  try {
    const missing = await request("/internal/economy-report");
    assert.equal(missing.status, 401);

    const wrong = await request("/internal/economy-report", { "X-Internal-Token": "wrong-token" });
    assert.equal(wrong.status, 401);
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
});

test("economy report route rejects an out-of-bounds time window before querying data", async () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "correct-token";
  try {
    const response = await request("/internal/economy-report?windowMs=1", {
      "X-Internal-Token": "correct-token",
    });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: "invalid_window" });
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
});

test("economy report route aggregates ledger flow and store spend inside the requested window", async () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "correct-token";
  try {
    await withMockPool(async (sql: string) => {
      if (sql.includes("FROM currency_ledger")) {
        return {
          rowCount: 3,
          rows: [
            { currency: "coins", reason: "match_reward", delta: "100", event_count: "2" },
            { currency: "coins", reason: "store_purchase", delta: "-30", event_count: "1" },
            { currency: "gems", reason: "google_play_void", delta: "-2", event_count: "1" },
          ],
        };
      }
      if (sql.includes("FROM store_purchases")) {
        return {
          rowCount: 2,
          rows: [
            { currency: "coins", purchase_count: "2", spend: "450" },
            { currency: "gems", purchase_count: "1", spend: "20" },
          ],
        };
      }
      throw new Error(`unexpected database query: ${sql}`);
    }, async () => {
      const response = await request("/internal/economy-report?windowMs=3600000", {
        "X-Internal-Token": "correct-token",
      });
      assert.equal(response.status, 200);
      const body = response.body as {
        window: { windowMs: number };
        currencies: Record<string, { faucet: number; sink: number; reversal: number; net: number; events: number }>;
        reasons: Record<string, { delta: number; events: number }>;
        storePurchases: Record<string, { purchases: number; spend: number }>;
      };
      assert.equal(body.window.windowMs, 3_600_000);
      assert.deepEqual(body.currencies.coins, { faucet: 100, sink: 30, reversal: 0, net: 70, events: 3 });
      assert.deepEqual(body.currencies.gems, { faucet: 0, sink: 0, reversal: 2, net: -2, events: 1 });
      assert.deepEqual(body.reasons.match_reward, { delta: 100, events: 2 });
      assert.deepEqual(body.storePurchases.coins, { purchases: 2, spend: 450 });
      assert.deepEqual(body.storePurchases.gems, { purchases: 1, spend: 20 });
    });
  } finally {
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
});

async function request(path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const server = createQuizRoyaleApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function withMockPool(query: LooseQuery, work: () => Promise<void>): Promise<void> {
  const target = pool as unknown as { query: LooseQuery };
  const original = target.query;
  target.query = query;
  try {
    await work();
  } finally {
    target.query = original;
  }
}
