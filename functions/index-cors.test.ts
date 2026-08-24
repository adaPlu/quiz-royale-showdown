import assert from "node:assert/strict";
import test from "node:test";
import worker from "./index.ts";

const env = {} as Parameters<typeof worker.fetch>[1];
const context = {} as Parameters<typeof worker.fetch>[2];

test("approved browser origin is reflected instead of wildcarded", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/health", {
      headers: { Origin: "https://play.quizroyale.gg" },
    }),
    env,
    context,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://play.quizroyale.gg");
  assert.equal(response.headers.get("Vary"), "Origin");
});

test("unknown browser origin is rejected before route handling", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/health", {
      headers: { Origin: "https://malicious.example" },
    }),
    env,
    context,
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("native requests without Origin remain allowed", async () => {
  const response = await worker.fetch(
    new Request("https://worker.example/health"),
    env,
    context,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), null);
});

test("configured preview origin can be added without wildcard access", async () => {
  const previewEnv = { CORS_ORIGINS: "https://preview.quiz.pages.dev" } as Parameters<typeof worker.fetch>[1];
  const response = await worker.fetch(
    new Request("https://worker.example/health", {
      headers: { Origin: "https://preview.quiz.pages.dev" },
    }),
    previewEnv,
    context,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "https://preview.quiz.pages.dev");
});
