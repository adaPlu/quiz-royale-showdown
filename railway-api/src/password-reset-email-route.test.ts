import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { pool } from "./db.js";
import { createQuizRoyaleApiServer } from "./server.js";

const ENDPOINT = "https://mailer.test/reset";
const RECIPIENT = "reset-recipient@example.test";
const FROM = "no-reply@quizroyale.test";
const PROVIDER_TOKEN = "provider-secret-test-value";
const USER_ID = "user-reset-test";

test("forgot-password sends the expected provider payload and records sanitized acceptance", async () => {
  const result = await runScenario({ providerStatus: 202 });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.response.body, { ok: true });
  assert.equal(result.providerCalls.length, 1);

  const call = result.providerCalls[0]!;
  assert.equal(call.method, "POST");
  assert.equal(call.headers.get("content-type"), "application/json");
  assert.equal(call.headers.get("authorization"), `Bearer ${PROVIDER_TOKEN}`);
  assert.equal(call.body.to, RECIPIENT);
  assert.equal(call.body.from, FROM);
  assert.equal(call.body.subject, "Reset your Quiz Royale password");
  assert.equal(typeof call.body.text, "string");

  const text = String(call.body.text);
  assert.match(text, /^Hi ResetTester,/);
  assert.match(text, /This code expires in 30 minutes\./);
  const tokenMatch = text.match(/Use this one-time reset code to create a new Quiz Royale password:\n([^\n]+)\n/);
  assert(tokenMatch, "email should contain a one-time reset code");
  const token = tokenMatch[1]!;
  assert.match(text, new RegExp(`Reset link: quizroyale:\/\/reset-password\\?token=${escapeRegExp(encodeURIComponent(token))}`));

  assert.equal(
    result.infoLogs.some((entry) => entry[0] === "password reset email accepted" && entry[1] === USER_ID && entry[2] === 202),
    true,
  );
  assertLogsAreSanitized(result.infoLogs, result.errorLogs);
});

test("forgot-password keeps generic success when the provider rejects delivery", async () => {
  const result = await runScenario({ providerStatus: 503 });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.response.body, { ok: true });
  assert.equal(result.providerCalls.length, 1);
  assert.equal(
    result.errorLogs.some((entry) => entry[0] === "password reset email failed" && entry[1] === USER_ID && entry[2] === "email provider returned 503"),
    true,
  );
  assert.equal(result.infoLogs.some((entry) => entry[0] === "password reset email accepted"), false);
  assertLogsAreSanitized(result.infoLogs, result.errorLogs);
});

test("forgot-password suppresses delivery safely when the email endpoint is not configured", async () => {
  const result = await runScenario({ endpointConfigured: false });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.response.body, { ok: true });
  assert.equal(result.providerCalls.length, 0);
  assert.equal(
    result.infoLogs.some((entry) => entry[0] === "Password reset email not configured; reset token suppressed" && entry[1] === USER_ID),
    true,
  );
  assertLogsAreSanitized(result.infoLogs, result.errorLogs);
});

test("forgot-password does not reveal whether an unknown account exists", async () => {
  const result = await runScenario({ userFound: false });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.response.body, { ok: true });
  assert.equal(result.providerCalls.length, 0);
  assert.equal(result.infoLogs.some((entry) => entry[0] === "password reset email accepted"), false);
  assert.equal(result.errorLogs.some((entry) => entry[0] === "password reset email failed"), false);
});

type ProviderCall = {
  method: string;
  headers: Headers;
  body: Record<string, unknown>;
};

async function runScenario(options: {
  providerStatus?: number;
  endpointConfigured?: boolean;
  userFound?: boolean;
} = {}): Promise<{
  response: { status: number; body: unknown };
  providerCalls: ProviderCall[];
  infoLogs: unknown[][];
  errorLogs: unknown[][];
}> {
  const providerStatus = options.providerStatus ?? 202;
  const endpointConfigured = options.endpointConfigured ?? true;
  const userFound = options.userFound ?? true;
  const previousEnv = {
    endpoint: process.env.PASSWORD_RESET_EMAIL_ENDPOINT,
    token: process.env.PASSWORD_RESET_EMAIL_TOKEN,
    from: process.env.PASSWORD_RESET_FROM,
    base: process.env.PASSWORD_RESET_BASE_URL,
  };
  if (endpointConfigured) process.env.PASSWORD_RESET_EMAIL_ENDPOINT = ENDPOINT;
  else delete process.env.PASSWORD_RESET_EMAIL_ENDPOINT;
  process.env.PASSWORD_RESET_EMAIL_TOKEN = PROVIDER_TOKEN;
  process.env.PASSWORD_RESET_FROM = FROM;
  process.env.PASSWORD_RESET_BASE_URL = "quizroyale://reset-password";

  const target = pool as any;
  const originalQuery = target.query;
  const originalConnect = target.connect;
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalError = console.error;
  const infoLogs: unknown[][] = [];
  const errorLogs: unknown[][] = [];
  const providerCalls: ProviderCall[] = [];

  const user = {
    user_id: USER_ID,
    username: "ResetTester",
    username_lower: "resettester",
    email: RECIPIENT,
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
    if (sql.includes("SELECT * FROM users WHERE email")) return { rowCount: userFound ? 1 : 0, rows: userFound ? [user] : [] };
    throw new Error(`unexpected pool query: ${sql}`);
  };
  target.connect = async () => client;
  console.info = (...args: unknown[]) => { infoLogs.push(args); };
  console.error = (...args: unknown[]) => { errorLogs.push(args); };
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url === ENDPOINT) {
      providerCalls.push({
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      });
      return new Response("", { status: providerStatus });
    }
    return originalFetch(input, init);
  }) as typeof fetch;

  try {
    const response = await request("POST", "/auth/forgot-password", { identifier: RECIPIENT });
    return { response, providerCalls, infoLogs, errorLogs };
  } finally {
    target.query = originalQuery;
    target.connect = originalConnect;
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.error = originalError;
    restoreEnv("PASSWORD_RESET_EMAIL_ENDPOINT", previousEnv.endpoint);
    restoreEnv("PASSWORD_RESET_EMAIL_TOKEN", previousEnv.token);
    restoreEnv("PASSWORD_RESET_FROM", previousEnv.from);
    restoreEnv("PASSWORD_RESET_BASE_URL", previousEnv.base);
  }
}

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

function assertLogsAreSanitized(infoLogs: unknown[][], errorLogs: unknown[][]): void {
  const renderedLogs = JSON.stringify([infoLogs, errorLogs]);
  assert.equal(renderedLogs.includes(RECIPIENT), false);
  assert.equal(renderedLogs.includes(PROVIDER_TOKEN), false);
  assert.equal(renderedLogs.includes("quizroyale://reset-password?token="), false);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
