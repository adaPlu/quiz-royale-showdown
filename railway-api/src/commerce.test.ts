import assert from "node:assert/strict";
import test from "node:test";
import { voidReversalAmount } from "./commerce.js";

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
