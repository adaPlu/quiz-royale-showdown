import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { handleCommerceRequest, rtdnEventKind, voidReversalAmount } from "./commerce.js";

test("full void reverses the remaining granted entitlement", () => {
  assert.equal(voidReversalAmount(500, 500, 0, null), 500);
  assert.equal(voidReversalAmount(500, 500, 200, null), 300);
});

test("quantity partial refunds reverse only refunded units", () => {
  assert.equal(voidReversalAmount(1200, 600, 0, 1), 600);
  assert.equal(voidReversalAmount(1200, 600, 600, 1), 600);
});

test("refund reversal is capped at the original grant", () => {
  assert.equal(voidReversalAmount(500, 500, 500, 1), 0);
  assert.equal(voidReversalAmount(500, 500, 0, 9), 500);
});



test("RTDN lifecycle events are classified without trusting notification contents", () => {
  assert.equal(rtdnEventKind({ voidedPurchaseNotification: {} }), "voided_purchase");
  assert.equal(rtdnEventKind({ pendingRefundReviewNotification: {} }), "pending_refund_review");
  assert.equal(rtdnEventKind({ oneTimeProductNotification: {} }), "one_time_product");
  assert.equal(rtdnEventKind({ testNotification: {} }), "test");
  assert.equal(rtdnEventKind({}), "unknown");
});

test("billing diagnostics are internal-only", async () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "internal-test-token";
  const server = http.createServer(async (request, response) => {
    if (await handleCommerceRequest(request, response)) return;
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    const oldPublic = await fetch(`http://127.0.0.1:${address.port}/store/billing-status`);
    assert.equal(oldPublic.status, 404);

    const missing = await fetch(`http://127.0.0.1:${address.port}/internal/billing-status`);
    assert.equal(missing.status, 401);

    const wrong = await fetch(`http://127.0.0.1:${address.port}/internal/billing-status`, {
      headers: { "X-Internal-Token": "wrong" },
    });
    assert.equal(wrong.status, 401);

    const allowed = await fetch(`http://127.0.0.1:${address.port}/internal/billing-status`, {
      headers: { "X-Internal-Token": "internal-test-token" },
    });
    assert.equal(allowed.status, 200);
    const body = await allowed.json() as Record<string, unknown>;
    assert.equal(body.service, "quiz-royale-api");
    assert.equal("private_key" in body, false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
});
