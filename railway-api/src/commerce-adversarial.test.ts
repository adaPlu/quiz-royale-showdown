import assert from "node:assert/strict";
import test from "node:test";
import { refundReviewDeadlineState, rtdnEventKind, voidReversalAmount } from "./commerce.js";

test("void reversal never exceeds remaining entitlement across adversarial quantities", () => {
  const grants = [0, 1, 50, 500, 1_200, 10_000, Number.MAX_SAFE_INTEGER];
  const units = [0, 1, 10, 500, 600, 5_000];
  const alreadyReversed = [0, 1, 50, 500, 1_200, 20_000];
  const refundQuantities: Array<number | null> = [null, 0, 1, 2, 9, 1_000_000];

  for (const grant of grants) {
    for (const unitGrant of units) {
      for (const reversed of alreadyReversed) {
        for (const quantity of refundQuantities) {
          const reversal = voidReversalAmount(grant, unitGrant, reversed, quantity);
          const remaining = Math.max(0, grant - Math.max(0, reversed));
          assert.ok(Number.isFinite(reversal));
          assert.ok(reversal >= 0);
          assert.ok(reversal <= remaining, `reversal ${reversal} exceeded remaining ${remaining}`);
        }
      }
    }
  }
});

test("duplicate partial-refund arithmetic converges to the original grant and never creates credit", () => {
  const originalGrant = 1_200;
  const unitGrant = 600;
  let reversed = 0;

  reversed += voidReversalAmount(originalGrant, unitGrant, reversed, 1);
  assert.equal(reversed, 600);
  reversed += voidReversalAmount(originalGrant, unitGrant, reversed, 1);
  assert.equal(reversed, 1_200);
  reversed += voidReversalAmount(originalGrant, unitGrant, reversed, 1);
  assert.equal(reversed, 1_200);
});

test("RTDN classifier remains presence-based and preserves lifecycle precedence", () => {
  const classifyMalformed = (value: unknown) => rtdnEventKind(value as Parameters<typeof rtdnEventKind>[0]);
  assert.equal(classifyMalformed({ pendingRefundReviewNotification: null }), "unknown");
  assert.equal(classifyMalformed({ oneTimeProductNotification: "forged" }), "one_time_product");
  assert.equal(classifyMalformed({ testNotification: 7 }), "test");
  assert.equal(
    classifyMalformed({ voidedPurchaseNotification: {}, oneTimeProductNotification: {} }),
    "voided_purchase",
  );
});

test("refund review deadline boundary is stable at due-soon and overdue transitions", () => {
  const now = 1_000_000;
  const fourHours = 4 * 60 * 60 * 1000;
  assert.equal(refundReviewDeadlineState(now + fourHours + 1, now), "open");
  assert.equal(refundReviewDeadlineState(now + fourHours, now), "due_soon");
  assert.equal(refundReviewDeadlineState(now + 1, now), "due_soon");
  assert.equal(refundReviewDeadlineState(now, now), "overdue");
  assert.equal(refundReviewDeadlineState(now - 1, now), "overdue");
});

test("only exact structured productNotOwnedByUser consume failures are idempotent success", async () => {
  const commerce = await import("./commerce.js") as unknown as {
    isAlreadyFinalizedGooglePlayConsumeResponse?: (status: number, text: string) => boolean;
  };
  const classify = commerce.isAlreadyFinalizedGooglePlayConsumeResponse;
  assert.equal(typeof classify, "function", "expected Google Play consume classifier export");

  const exact = JSON.stringify({
    error: {
      code: 400,
      errors: [{ domain: "androidpublisher", reason: "productNotOwnedByUser" }],
    },
  });
  const wrongStatus = JSON.stringify({
    error: {
      code: 400,
      errors: [{ domain: "androidpublisher", reason: "productNotOwnedByUser" }],
    },
  });
  const wrongCode = JSON.stringify({
    error: {
      code: 403,
      errors: [{ domain: "androidpublisher", reason: "productNotOwnedByUser" }],
    },
  });
  const wrongDomain = JSON.stringify({
    error: {
      code: 400,
      errors: [{ domain: "global", reason: "productNotOwnedByUser" }],
    },
  });
  const unrelated = JSON.stringify({
    error: {
      code: 400,
      errors: [{ domain: "androidpublisher", reason: "invalidPurchaseToken" }],
    },
  });

  assert.equal(classify!(400, exact), true);
  assert.equal(classify!(409, wrongStatus), false);
  assert.equal(classify!(400, wrongCode), false);
  assert.equal(classify!(400, wrongDomain), false);
  assert.equal(classify!(400, unrelated), false);
  assert.equal(classify!(400, "not-json"), false);
  assert.equal(classify!(400, JSON.stringify({ error: { code: 400, errors: "bad-shape" } })), false);
});
