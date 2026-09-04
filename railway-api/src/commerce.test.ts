import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import {
  handleCommerceRequest,
  recordRtdnEvent,
  refundReviewDeadlineState,
  rtdnEventKind,
  voidReversalAmount,
} from "./commerce.js";
import { pool } from "./db.js";

const databaseTest = process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" ? test : test.skip;

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

test("pending refund review deadline states are explicit", () => {
  const now = 10_000_000;
  assert.equal(refundReviewDeadlineState(now + 5 * 60 * 60 * 1000, now), "open");
  assert.equal(refundReviewDeadlineState(now + 4 * 60 * 60 * 1000, now), "due_soon");
  assert.equal(refundReviewDeadlineState(now - 1, now), "overdue");
});

databaseTest("pending refund review RTDN delivery is idempotent by message and token", async () => {
  const suffix = randomUUID();
  const messageId = `pending-refund-message-${suffix}`;
  const secondMessageId = `pending-refund-message-2-${suffix}`;
  const pendingRefundToken = `pending-refund-token-${suffix}`;
  const orderId = `GPA.test-${suffix}`;
  const now = Date.now();
  const payload = {
    packageName: "com.rork.quizroyaleshowdown",
    eventTimeMillis: String(now),
    pendingRefundReviewNotification: {
      version: "1.0",
      pendingRefundToken,
      orderId,
      refundReason: 7,
    },
  };

  try {
    const first = await recordRtdnEvent(messageId, payload, now);
    const duplicateMessage = await recordRtdnEvent(messageId, payload, now + 1_000);
    const duplicateToken = await recordRtdnEvent(secondMessageId, payload, now + 2_000);

    assert.equal(first.duplicate, false);
    assert.match(first.reviewId ?? "", /^refund-[a-f0-9]{32}$/);
    assert.equal(duplicateMessage.duplicate, true);
    assert.equal(duplicateToken.duplicate, false);
    assert.equal(duplicateToken.reviewId, first.reviewId);

    const queue = await pool.query<{ count: number; deadline_at: string | number }>(
      `SELECT count(*)::int AS count, min(deadline_at) AS deadline_at
       FROM play_pending_refund_reviews
       WHERE pending_refund_token = $1`,
      [pendingRefundToken],
    );
    assert.equal(Number(queue.rows[0]?.count), 1);
    assert.equal(Number(queue.rows[0]?.deadline_at), now + 24 * 60 * 60 * 1000);
  } finally {
    await pool.query("DELETE FROM play_pending_refund_reviews WHERE pending_refund_token = $1", [pendingRefundToken]);
    await pool.query("DELETE FROM play_rtdn_events WHERE message_id = ANY($1::text[])", [[messageId, secondMessageId]]);
  }
});

test("billing and refund-review operations are internal-only", async () => {
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

    const reviewListMissing = await fetch(
      `http://127.0.0.1:${address.port}/internal/google-play/pending-refund-reviews`,
    );
    assert.equal(reviewListMissing.status, 401);

    const reviewSubmitMissing = await fetch(
      `http://127.0.0.1:${address.port}/internal/google-play/review-refund`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: "refund-test",
          refundPreference: "NEUTRAL",
          sampleContentProvided: false,
        }),
      },
    );
    assert.equal(reviewSubmitMissing.status, 401);

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

databaseTest("completed refund-review submissions are idempotent without another Google call", async () => {
  const previous = process.env.INTERNAL_API_TOKEN;
  process.env.INTERNAL_API_TOKEN = "internal-test-token";
  const suffix = randomUUID();
  const reviewId = `refund-${suffix.replace(/-/g, "").slice(0, 32)}`;
  const pendingRefundToken = `completed-review-token-${suffix}`;
  const orderId = `GPA.completed-${suffix}`;
  const now = Date.now();

  await pool.query(
    `INSERT INTO play_pending_refund_reviews(
       pending_refund_token, review_id, order_id, received_at, deadline_at,
       status, decision, sample_content_provided, consumption_usage_events,
       submit_attempts, google_status, completed_at, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, 'COMPLETED', 'NEUTRAL', false, '[]'::jsonb, 1, 200, $4, $4)`,
    [pendingRefundToken, reviewId, orderId, now, now + 24 * 60 * 60 * 1000],
  );

  const server = http.createServer(async (request, response) => {
    if (await handleCommerceRequest(request, response)) return;
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not_found" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;

  try {
    const same = await fetch(
      `http://127.0.0.1:${address.port}/internal/google-play/review-refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": "internal-test-token",
        },
        body: JSON.stringify({
          reviewId,
          refundPreference: "NEUTRAL",
          sampleContentProvided: false,
        }),
      },
    );
    assert.equal(same.status, 200);
    const sameBody = await same.json() as { ok?: boolean; duplicate?: boolean };
    assert.equal(sameBody.ok, true);
    assert.equal(sameBody.duplicate, true);

    const changed = await fetch(
      `http://127.0.0.1:${address.port}/internal/google-play/review-refund`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Internal-Token": "internal-test-token",
        },
        body: JSON.stringify({
          reviewId,
          refundPreference: "APPROVE",
          sampleContentProvided: false,
        }),
      },
    );
    assert.equal(changed.status, 409);

    const row = await pool.query<{ submit_attempts: number }>(
      "SELECT submit_attempts FROM play_pending_refund_reviews WHERE review_id = $1",
      [reviewId],
    );
    assert.equal(Number(row.rows[0]?.submit_attempts), 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await pool.query("DELETE FROM play_pending_refund_reviews WHERE review_id = $1", [reviewId]);
    if (previous === undefined) delete process.env.INTERNAL_API_TOKEN;
    else process.env.INTERNAL_API_TOKEN = previous;
  }
});
