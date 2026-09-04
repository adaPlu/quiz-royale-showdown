import assert from "node:assert/strict";
import test from "node:test";
import { sanitizeGooglePlayVoidedPurchasesUrl } from "./google-play-voided-fetch.js";

test("Google Play voided purchase query lets the server apply its canonical rolling window", () => {
  const endpoint = new URL("https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.rork.quizroyaleshowdown/purchases/voidedpurchases?startTime=1&endTime=2&type=0&includeQuantityBasedPartialRefund=true&maxResults=1000");
  const sanitized = sanitizeGooglePlayVoidedPurchasesUrl(endpoint);

  assert.equal(sanitized.searchParams.has("startTime"), false);
  assert.equal(sanitized.searchParams.has("endTime"), false);
  assert.equal(sanitized.searchParams.get("type"), "0");
  assert.equal(sanitized.searchParams.get("includeQuantityBasedPartialRefund"), "true");
  assert.equal(sanitized.searchParams.get("maxResults"), "1000");
});

test("Google Play voided purchase pagination preserves all non-window query parameters", () => {
  const endpoint = new URL("https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.rork.quizroyaleshowdown/purchases/voidedpurchases?startTime=1&endTime=2&type=0&includeQuantityBasedPartialRefund=true&maxResults=1000&token=next-page-token");
  const sanitized = sanitizeGooglePlayVoidedPurchasesUrl(endpoint);

  assert.equal(sanitized.searchParams.get("token"), "next-page-token");
  assert.equal(sanitized.searchParams.get("type"), "0");
  assert.equal(sanitized.searchParams.has("startTime"), false);
  assert.equal(sanitized.searchParams.has("endTime"), false);
});

test("unrelated Google APIs are left unchanged", () => {
  const endpoint = new URL("https://androidpublisher.googleapis.com/androidpublisher/v3/applications/example/purchases/products/item/tokens/token?startTime=1&endTime=2");
  const sanitized = sanitizeGooglePlayVoidedPurchasesUrl(endpoint);

  assert.equal(sanitized.toString(), endpoint.toString());
});
