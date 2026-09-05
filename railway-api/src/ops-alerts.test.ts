import assert from "node:assert/strict";
import test from "node:test";
import { OperationalFailureTracker, buildOperationalAlertWebhookPayload, type OperationalAlert } from "./ops-alerts.js";

test("failure tracker alerts only after the configured rate threshold", async () => {
  const alerts: OperationalAlert[] = [];
  const tracker = new OperationalFailureTracker(async (alert) => { alerts.push(alert); }, 3, 1_000, 5_000);

  assert.equal(await tracker.record("api", "one", 100), false);
  assert.equal(await tracker.record("api", "two", 200), false);
  assert.equal(await tracker.record("api", "three", 300), true);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.category, "api");
  assert.equal(alerts[0]?.count, 3);
});

test("failure tracker isolates categories and enforces cooldown", async () => {
  const alerts: OperationalAlert[] = [];
  const tracker = new OperationalFailureTracker(async (alert) => { alerts.push(alert); }, 2, 1_000, 5_000);

  await tracker.record("database", "db-1", 100);
  await tracker.record("commerce", "commerce-1", 150);
  assert.equal(await tracker.record("database", "db-2", 200), true);
  assert.equal(await tracker.record("database", "db-3", 300), false);
  assert.equal(await tracker.record("commerce", "commerce-2", 350), true);
  assert.deepEqual(alerts.map((alert) => alert.category), ["database", "commerce"]);
});

test("old failures age out and summaries are bounded to safe single-line text", async () => {
  const alerts: OperationalAlert[] = [];
  const tracker = new OperationalFailureTracker(async (alert) => { alerts.push(alert); }, 2, 100, 500);

  await tracker.record("matchmaking", "old", 1);
  assert.equal(await tracker.record("matchmaking", "new", 200), false);
  assert.equal(await tracker.record("matchmaking", `bad\n${"x".repeat(500)}`, 201), true);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0]?.summary.includes("\n"), false);
  assert.ok((alerts[0]?.summary.length ?? 0) <= 300);
});

test("buildOperationalAlertWebhookPayload creates Slack-compatible payload with top-level text field", () => {
  const previousCommit = process.env.RAILWAY_GIT_COMMIT_SHA;
  const previousEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME;
  process.env.RAILWAY_GIT_COMMIT_SHA = "abcdef1234567890";
  process.env.RAILWAY_ENVIRONMENT_NAME = "production";

  try {
    const alert: OperationalAlert = {
      service: "quiz-royale-api",
      category: "database",
      count: 7,
      windowMs: 60_000,
      occurredAt: 1_700_000_000_000,
      summary: "Database connection timeout",
    };

    const payload = buildOperationalAlertWebhookPayload(alert);

    assert.equal(typeof payload.text, "string");
    const text = payload.text as string;
    assert.ok(text.length > 0);
    assert.equal(text.includes("\n"), false);
    assert.equal(text.includes("\r"), false);
    assert.ok(text.length <= 300);

    assert.equal(payload.event, "quiz_royale_operational_alert");
    assert.equal(payload.service, alert.service);
    assert.equal(payload.category, alert.category);
    assert.equal(payload.count, alert.count);
    assert.equal(payload.windowMs, alert.windowMs);
    assert.equal(payload.occurredAt, alert.occurredAt);
    assert.equal(payload.summary, alert.summary);

    assert.equal(payload.deployCommit, "abcdef1234567890".slice(0, 12));
    assert.equal(payload.environment, "production");
  } finally {
    if (previousCommit === undefined) delete process.env.RAILWAY_GIT_COMMIT_SHA;
    else process.env.RAILWAY_GIT_COMMIT_SHA = previousCommit;
    if (previousEnvironment === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME;
    else process.env.RAILWAY_ENVIRONMENT_NAME = previousEnvironment;
  }
});
