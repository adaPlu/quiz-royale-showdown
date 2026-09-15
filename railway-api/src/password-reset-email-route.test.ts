import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { pool } from "./db.js";
import { createQuizRoyaleApiServer } from "./server.js";

test("forgot-password records sanitized provider acceptance while preserving generic success", async () => {
  const endpoint = "https://mailer.test/reset";
  const recipient = "reset-recipient@example.test";
  const providerToken = "provider-secret-test-value";
  const userId = "user-reset-test";
  const previousEnv = {
    endpoint: process.env.PASSWORD_RESET_EMAIL_ENDPOINT,
    token: process.env.PASSWORD_RESET_EMAIL_TOKEN,
    from: process.env.PASSWORD_RESET_FROM,
    base: process.env.PASSWORD_RESET_BASE_URL,
  };
  process.env.PASSWORD_RESET_EMAIL_ENDPOINT = endpoint;
  process.env.PASSWORD_RESET_EMAIL_TOKEN = providerToken;
  process.env.PASSWORD_RESET_FROM = "no-reply@quizroyale.test";
  process.env.PASSWORD_RESET_BASE_URL = "quizroyale://reset-password";

  const target = pool as any;
  const originalQuery = target.query;
  const originalConnect = target.connect;
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const infoLogs: unknown[][] = [];
  let providerCalls = 0;

  const user = {
    user_id: userId,
    username: "ResetTester",
    username_lower: "resettester",
    email: recipient,
    password_hash: "unused",
    role: "USER",
    entitlements: null,
    currency_balances: null,
    created_at: Date.now(),
    last_login_at: Date.now(),
  };

  const client = {
    async query(sql: string) {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rowCount: 0, rows: [] };
      if (sql.includes("DELETE FROM password_reset_tokens")) return { rowCount: 1, rows: [] };
      if (sql.includes("INSERT INTO password_reset_tokens")) return { rowCount: 1, rows: [] };
      throw new Error(`unexpected transaction query: ${sql}`);
    },
    release() {},
  };

  target.query = async (sql: string) => {
    if (sql.includes("auth_rate_limits")) return { rowCount: 1, rows: [{ count: 1, reset_at: Date.now() + 60_000 }] };
    if (sql.includes("SELECT * FROM users WHERE email")) return { rowCount: 1, rows: [user] };
    throw new Error(`unexpected pool query: ${sql}`);
  };
  target.connect = async () => client;
  console.info = (...args: unknown[]) => { infoLogs.push(args); };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === endpoint) {
      providerCalls += 1;
      return new Response("", { status: 202 });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const response = await request("POST", "/auth/forgot-password", { identifier: recipient });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
    assert.equal(providerCalls, 1);
    assert.equal(
      infoLogs.some((entry) => entry[0] === "password reset email accepted" && entry[1] === userId && entry[2] === 202),
      true,
      "provider acceptance should be observable without exposing the reset token",
    );
    const renderedLogs = JSON.stringify(infoLogs);
    assert.equal(renderedLogs.includes(recipient), false);
    assert.equal(renderedLogs.includes(providerToken), false);
  } finally {
    target.query = originalQuery;
    target.connect = originalConnect;
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    restoreEnv("PASSWORD_RESET_EMAIL_ENDPOINT", previousEnv.endpoint);
    restoreEnv("PASSWORD_RESET_EMAIL_TOKEN", previousEnv.token);
    restoreEnv("PASSWORD_RESET_FROM", previousEnv.from);
    restoreEnv("PASSWORD_RESET_BASE_URL", previousEnv.base);
  }
});

async function request(
  method: string,
  path: string,
  body: unknown,
): Promise<{ status: number; body: unknown }> {
  const server = createQuizRoyaleApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address === "object");
  const port = (address as AddressInfo).port;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
