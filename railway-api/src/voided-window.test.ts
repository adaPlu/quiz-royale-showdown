import assert from "node:assert/strict";
import test from "node:test";
import { buildVoidedPurchasesEndpoint } from "./commerce.js";

test("Google Play voided purchase query lets the server apply its canonical rolling window", () => {
  const endpoint = buildVoidedPurchasesEndpoint(null);

  assert.equal(endpoint.searchParams.has("startTime"), false);
  assert.equal(endpoint.searchParams.has("endTime"), false);
  assert.equal(endpoint.searchParams.get("type"), "0");
  assert.equal(endpoint.searchParams.get("includeQuantityBasedPartialRefund"), "true");
  assert.equal(endpoint.searchParams.get("maxResults"), "1000");
});

test("Google Play voided purchase pagination preserves the server-defined time window", () => {
  const endpoint = buildVoidedPurchasesEndpoint("next-page-token");

  assert.equal(endpoint.searchParams.get("token"), "next-page-token");
  assert.equal(endpoint.searchParams.has("startTime"), false);
  assert.equal(endpoint.searchParams.has("endTime"), false);
});
