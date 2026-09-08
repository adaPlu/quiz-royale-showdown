import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createQuizRoyaleApiServer } from "./server.js";

test("operational alert certification route requires the internal token", async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousWebhook = process.env.OPS_ALERT_WEBHOOK_URL;
  process.env.INTERNAL_API_TOKEN = "correct-token";
  delete process.env.OPS_ALERT_WEBHOOK_URL;

  try {
    const missing = await request({});
    assert.equal(missing.status, 401);

    const wrong = await request({ "X-Internal-Token": "wrong-token" });
    assert.equal(wrong.status, 401);
  } finally {
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
    if (previousWebhook === undefined) delete process.env.OPS_ALERT_WEBHOOK_URL;
    else process.env.OPS_ALERT_WEBHOOK_URL = previousWebhook;
  }
});

test("operational alert certification route reports missing webhook after authentication", async () => {
  const previousToken = process.env.INTERNAL_API_TOKEN;
  const previousWebhook = process.env.OPS_ALERT_WEBHOOK_URL;
  process.env.INTERNAL_API_TOKEN = "correct-token";
  delete process.env.OPS_ALERT_WEBHOOK_URL;

  try {
    const response = await request({ "X-Internal-Token": "correct-token" });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, { error: "ops_alert_not_configured" });
  } finally {
    if (previousToken === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previousToken;
    if (previousWebhook === undefined) delete process.env.OPS_ALERT_WEBHOOK_URL;
    else process.env.OPS_ALERT_WEBHOOK_URL = previousWebhook;
  }
});

async function request(headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const server = createQuizRoyaleApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/internal/ops-alert-test`, {
      method: "POST",
      headers,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}
