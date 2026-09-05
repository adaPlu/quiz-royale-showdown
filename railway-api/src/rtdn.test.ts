import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { handleCommerceRequest } from "./commerce.js";
import { pool } from "./db.js";

const databaseTest = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? test : test.skip;
const EXPECTED_AUDIENCE = "https://railway-api.example/google-play/rtdn";
const EXPECTED_EMAIL = "quiz-rtdn-push@example.iam.gserviceaccount.com";
const PACKAGE_NAME = "com.rork.quizroyaleshowdown";

type GoogleClaims = {
  aud?: string;
  email?: string;
  email_verified?: string;
  exp?: string;
  iss?: string;
};

function approvedClaims(): GoogleClaims {
  return {
    aud: EXPECTED_AUDIENCE,
    email: EXPECTED_EMAIL,
    email_verified: "true",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    iss: "https://accounts.google.com",
  };
}

function encodedPayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

async function withRtdnEnvironment(work: () => Promise<void>): Promise<void> {
  const previousAudience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const previousEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  const previousBilling = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64;
  process.env.GOOGLE_PLAY_RTDN_AUDIENCE = EXPECTED_AUDIENCE;
  process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = EXPECTED_EMAIL;
  delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64;
  try {
    await work();
  } finally {
    if (previousAudience === undefined) delete process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
    else process.env.GOOGLE_PLAY_RTDN_AUDIENCE = previousAudience;
    if (previousEmail === undefined) delete process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = previousEmail;
    if (previousBilling === undefined) delete process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64;
    else process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64 = previousBilling;
  }
}

async function invokeRtdn(
  body: unknown,
  options: {
    authorization?: string | null;
    claims?: GoogleClaims | null;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const previousFetch = globalThis.fetch;
  const claims = options.claims === undefined ? approvedClaims() : options.claims;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url.startsWith("https://oauth2.googleapis.com/tokeninfo?")) {
      if (!claims) return new Response("unauthorized", { status: 401 });
      return new Response(JSON.stringify(claims), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return previousFetch(input, init);
  }) as typeof fetch;

  const server = http.createServer(async (request, response) => {
    if (await handleCommerceRequest(request, response)) return;
    response.statusCode = 404;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const authorization = options.authorization === undefined ? "Bearer test-token" : options.authorization;
    if (authorization !== null) headers.Authorization = authorization;
    const response = await globalThis.fetch(`http://127.0.0.1:${address.port}/google-play/rtdn`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    return {
      status: response.status,
      body: await response.json() as Record<string, unknown>,
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    globalThis.fetch = previousFetch;
  }
}

test("RTDN returns 503 when authenticated push configuration is missing", async () => {
  const previousAudience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const previousEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  delete process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  try {
    const result = await invokeRtdn({});
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "rtdn_not_configured");
  } finally {
    if (previousAudience === undefined) delete process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
    else process.env.GOOGLE_PLAY_RTDN_AUDIENCE = previousAudience;
    if (previousEmail === undefined) delete process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = previousEmail;
  }
});

test("RTDN rejects requests without a bearer token", async () => {
  await withRtdnEnvironment(async () => {
    const result = await invokeRtdn({}, { authorization: null });
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
  });
});

test("RTDN accepts only the configured Google push identity claims", async () => {
  await withRtdnEnvironment(async () => {
    const accepted = await invokeRtdn({
      message: {
        messageId: "claims-accepted",
        data: encodedPayload({ packageName: "com.example.other", testNotification: {} }),
      },
    });
    assert.equal(accepted.status, 200);
    assert.equal(accepted.body.ignored, "package_mismatch");

    const now = Math.floor(Date.now() / 1000);
    const invalidClaims: GoogleClaims[] = [
      { ...approvedClaims(), aud: "wrong-audience" },
      { ...approvedClaims(), email: "wrong@example.com" },
      { ...approvedClaims(), email_verified: "false" },
      { ...approvedClaims(), exp: String(now - 60) },
      { ...approvedClaims(), iss: "https://example.com" },
    ];
    for (const claims of invalidClaims) {
      const rejected = await invokeRtdn({}, { claims });
      assert.equal(rejected.status, 401);
      assert.equal(rejected.body.error, "unauthorized");
    }
  });
});

test("RTDN rejects a token Google tokeninfo does not accept", async () => {
  await withRtdnEnvironment(async () => {
    const result = await invokeRtdn({}, { claims: null });
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
  });
});

test("RTDN rejects malformed Pub/Sub envelopes", async () => {
  await withRtdnEnvironment(async () => {
    const result = await invokeRtdn({});
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_pubsub_message");
  });
});

test("RTDN rejects invalid base64 or JSON notification data", async () => {
  await withRtdnEnvironment(async () => {
    const result = await invokeRtdn({ message: { messageId: "bad-payload", data: "!!!!" } });
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_rtdn_payload");
  });
});

test("RTDN acknowledges a package mismatch instead of creating a retry loop", async () => {
  await withRtdnEnvironment(async () => {
    const result = await invokeRtdn({
      message: {
        messageId: "package-mismatch",
        data: encodedPayload({ packageName: "com.example.other", testNotification: {} }),
      },
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.ignored, "package_mismatch");
  });
});

databaseTest("RTDN records a valid test notification without purchase reconciliation", async () => {
  await withRtdnEnvironment(async () => {
    const messageId = `rtdn-test-${randomUUID()}`;
    try {
      const result = await invokeRtdn({
        message: {
          messageId,
          data: encodedPayload({ packageName: PACKAGE_NAME, testNotification: { version: "1.0" } }),
        },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.eventKind, "test");

      const row = await pool.query<{ event_kind: string }>(
        "SELECT event_kind FROM play_rtdn_events WHERE message_id = $1",
        [messageId],
      );
      assert.equal(row.rows[0]?.event_kind, "test");
    } finally {
      await pool.query("DELETE FROM play_rtdn_events WHERE message_id = $1", [messageId]);
    }
  });
});

databaseTest("RTDN duplicate Pub/Sub messageId is acknowledged idempotently", async () => {
  await withRtdnEnvironment(async () => {
    const messageId = `rtdn-duplicate-${randomUUID()}`;
    const envelope = {
      message: {
        messageId,
        data: encodedPayload({ packageName: PACKAGE_NAME, testNotification: { version: "1.0" } }),
      },
    };
    try {
      const first = await invokeRtdn(envelope);
      const duplicate = await invokeRtdn(envelope);
      assert.equal(first.status, 200);
      assert.equal(first.body.eventKind, "test");
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.duplicate, true);

      const count = await pool.query<{ count: number }>(
        "SELECT count(*)::int AS count FROM play_rtdn_events WHERE message_id = $1",
        [messageId],
      );
      assert.equal(Number(count.rows[0]?.count), 1);
    } finally {
      await pool.query("DELETE FROM play_rtdn_events WHERE message_id = $1", [messageId]);
    }
  });
});

databaseTest("RTDN records a one-time-product lifecycle signal", async () => {
  await withRtdnEnvironment(async () => {
    const messageId = `rtdn-one-time-${randomUUID()}`;
    try {
      const result = await invokeRtdn({
        message: {
          messageId,
          data: encodedPayload({
            packageName: PACKAGE_NAME,
            oneTimeProductNotification: { version: "1.0", notificationType: 1, purchaseToken: "redacted-test-token", sku: "coins_500" },
          }),
        },
      });
      assert.equal(result.status, 200);
      assert.equal(result.body.eventKind, "one_time_product");

      const row = await pool.query<{ event_kind: string }>(
        "SELECT event_kind FROM play_rtdn_events WHERE message_id = $1",
        [messageId],
      );
      assert.equal(row.rows[0]?.event_kind, "one_time_product");
    } finally {
      await pool.query("DELETE FROM play_rtdn_events WHERE message_id = $1", [messageId]);
    }
  });
});
