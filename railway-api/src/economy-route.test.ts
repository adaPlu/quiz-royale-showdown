import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createQuizRoyaleApiServer } from "./server.js";

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
