import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  handleGooglePlayRtdn,
  verifyGooglePushToken,
  type GooglePlayRtdnDependencies,
} from "./commerce.js";

const EXPECTED_AUDIENCE = "https://railway-api.example/google-play/rtdn";
const EXPECTED_EMAIL = "quiz-rtdn-push@example.iam.gserviceaccount.com";
const PACKAGE_NAME = "com.rork.quizroyaleshowdown";

function approvedIdentity() {
  return {
    aud: EXPECTED_AUDIENCE,
    email: EXPECTED_EMAIL,
    email_verified: "true",
    exp: String(Math.floor(Date.now() / 1000) + 3600),
    iss: "https://accounts.google.com",
  };
}

function dependencies(
  overrides: Partial<GooglePlayRtdnDependencies> = {},
): GooglePlayRtdnDependencies {
  return {
    verifyToken: async () => approvedIdentity(),
    recordEvent: async (_messageId, payload) => ({
      duplicate: false,
      eventKind: payload.testNotification ? "test" : payload.oneTimeProductNotification ? "one_time_product" : "unknown",
    }),
    reconcileVoids: async () => ({ ok: true }),
    ...overrides,
  };
}

async function invokeRtdn(
  body: unknown,
  deps: GooglePlayRtdnDependencies,
  authorization: string | null = "Bearer test-token",
): Promise<{ status: number; body: Record<string, unknown> }> {
  const server = http.createServer(async (request, response) => {
    const result = await handleGooglePlayRtdn(request, deps);
    response.statusCode = result.status;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (authorization !== null) headers.Authorization = authorization;
    const response = await fetch(`http://127.0.0.1:${address.port}/google-play/rtdn`, {
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
  }
}

function encodedPayload(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64");
}

async function withRtdnEnvironment(work: () => Promise<void>): Promise<void> {
  const previousAudience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const previousEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  process.env.GOOGLE_PLAY_RTDN_AUDIENCE = EXPECTED_AUDIENCE;
  process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = EXPECTED_EMAIL;
  try {
    await work();
  } finally {
    if (previousAudience === undefined) delete process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
    else process.env.GOOGLE_PLAY_RTDN_AUDIENCE = previousAudience;
    if (previousEmail === undefined) delete process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
    else process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL = previousEmail;
  }
}

test("RTDN returns 503 when authenticated push configuration is missing", async () => {
  const previousAudience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  const previousEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  delete process.env.GOOGLE_PLAY_RTDN_AUDIENCE;
  delete process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL;
  try {
    const result = await invokeRtdn({}, dependencies());
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
    const result = await invokeRtdn({}, dependencies(), null);
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
  });
});

test("RTDN rejects a bearer token when Google push identity verification fails", async () => {
  await withRtdnEnvironment(async () => {
    const result = await invokeRtdn({}, dependencies({ verifyToken: async () => null }));
    assert.equal(result.status, 401);
    assert.equal(result.body.error, "unauthorized");
  });
});

test("RTDN rejects malformed Pub/Sub envelopes before recording an event", async () => {
  await withRtdnEnvironment(async () => {
    let recorded = 0;
    const result = await invokeRtdn({}, dependencies({
      recordEvent: async () => {
        recorded += 1;
        return { duplicate: false, eventKind: "unknown" };
      },
    }));
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_pubsub_message");
    assert.equal(recorded, 0);
  });
});

test("RTDN rejects invalid base64 or JSON notification data", async () => {
  await withRtdnEnvironment(async () => {
    const result = await invokeRtdn({ message: { messageId: "bad-payload", data: "!!!!" } }, dependencies());
    assert.equal(result.status, 400);
    assert.equal(result.body.error, "invalid_rtdn_payload");
  });
});

test("RTDN acknowledges a package mismatch without recording or reconciling", async () => {
  await withRtdnEnvironment(async () => {
    let recorded = 0;
    let reconciled = 0;
    const result = await invokeRtdn({
      message: {
        messageId: "package-mismatch",
        data: encodedPayload({ packageName: "com.example.other", testNotification: {} }),
      },
    }, dependencies({
      recordEvent: async () => {
        recorded += 1;
        return { duplicate: false, eventKind: "test" };
      },
      reconcileVoids: async () => {
        reconciled += 1;
        return { ok: true };
      },
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.ignored, "package_mismatch");
    assert.equal(recorded, 0);
    assert.equal(reconciled, 0);
  });
});

test("RTDN accepts a valid test notification without purchase reconciliation", async () => {
  await withRtdnEnvironment(async () => {
    let recorded = 0;
    let reconciled = 0;
    const result = await invokeRtdn({
      message: {
        messageId: "test-message",
        data: encodedPayload({ packageName: PACKAGE_NAME, testNotification: { version: "1.0" } }),
      },
    }, dependencies({
      recordEvent: async (messageId) => {
        recorded += 1;
        assert.equal(messageId, "test-message");
        return { duplicate: false, eventKind: "test" };
      },
      reconcileVoids: async () => {
        reconciled += 1;
        return { ok: true };
      },
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.eventKind, "test");
    assert.equal(recorded, 1);
    assert.equal(reconciled, 0);
  });
});

test("RTDN duplicate messageId is acknowledged without another reconciliation", async () => {
  await withRtdnEnvironment(async () => {
    let reconciled = 0;
    const result = await invokeRtdn({
      message: {
        messageId: "duplicate-message",
        data: encodedPayload({ packageName: PACKAGE_NAME, oneTimeProductNotification: { notificationType: 1 } }),
      },
    }, dependencies({
      recordEvent: async () => ({ duplicate: true, eventKind: "one_time_product" }),
      reconcileVoids: async () => {
        reconciled += 1;
        return { ok: true };
      },
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.duplicate, true);
    assert.equal(reconciled, 0);
  });
});

test("RTDN one-time-product signal triggers one authoritative reconciliation", async () => {
  await withRtdnEnvironment(async () => {
    let reconciled = 0;
    const result = await invokeRtdn({
      message: {
        messageId: "one-time-product-message",
        data: encodedPayload({ packageName: PACKAGE_NAME, oneTimeProductNotification: { notificationType: 1 } }),
      },
    }, dependencies({
      recordEvent: async () => ({ duplicate: false, eventKind: "one_time_product" }),
      reconcileVoids: async () => {
        reconciled += 1;
        return { ok: true };
      },
    }));
    assert.equal(result.status, 200);
    assert.equal(result.body.eventKind, "one_time_product");
    assert.equal(reconciled, 1);
  });
});

test("Google push verifier accepts matching tokeninfo claims", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify(approvedIdentity()), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  })) as typeof fetch;
  try {
    const result = await verifyGooglePushToken("token", EXPECTED_AUDIENCE, EXPECTED_EMAIL);
    assert.equal(result?.aud, EXPECTED_AUDIENCE);
    assert.equal(result?.email, EXPECTED_EMAIL);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Google push verifier rejects mismatched, unverified, expired, or non-Google claims", async () => {
  const previousFetch = globalThis.fetch;
  const now = Math.floor(Date.now() / 1000);
  const invalidClaims = [
    { ...approvedIdentity(), aud: "wrong-audience" },
    { ...approvedIdentity(), email: "wrong@example.com" },
    { ...approvedIdentity(), email_verified: "false" },
    { ...approvedIdentity(), exp: String(now - 60) },
    { ...approvedIdentity(), iss: "https://example.com" },
  ];

  try {
    for (const claims of invalidClaims) {
      globalThis.fetch = (async () => new Response(JSON.stringify(claims), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })) as typeof fetch;
      assert.equal(await verifyGooglePushToken("token", EXPECTED_AUDIENCE, EXPECTED_EMAIL), null);
    }
  } finally {
    globalThis.fetch = previousFetch;
  }
});
