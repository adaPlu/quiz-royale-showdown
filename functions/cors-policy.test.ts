import assert from "node:assert/strict";
import test from "node:test";
import { allowedBrowserOrigins, isBrowserOriginAllowed } from "./cors-policy.ts";

test("approved production browser origins are allowed", () => {
  assert.equal(isBrowserOriginAllowed("https://quizroyale.gg"), true);
  assert.equal(isBrowserOriginAllowed("https://www.quizroyale.gg"), true);
  assert.equal(isBrowserOriginAllowed("https://play.quizroyale.gg"), true);
});

test("unknown browser origin is rejected", () => {
  assert.equal(isBrowserOriginAllowed("https://malicious.example"), false);
});

test("native requests without Origin remain allowed", () => {
  assert.equal(isBrowserOriginAllowed(null), true);
  assert.equal(isBrowserOriginAllowed(undefined), true);
  assert.equal(isBrowserOriginAllowed(""), true);
});

test("configured preview origins are exact and do not create wildcard access", () => {
  const config = { CORS_ORIGINS: "https://preview.quiz.pages.dev, https://staging.quizroyale.gg/" };
  const origins = allowedBrowserOrigins(config);
  assert.equal(origins.has("https://preview.quiz.pages.dev"), true);
  assert.equal(origins.has("https://staging.quizroyale.gg"), true);
  assert.equal(origins.has("https://other.pages.dev"), false);
});
