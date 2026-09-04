import assert from "node:assert/strict";
import test from "node:test";
import { OperationalFailureTracker, type OperationalAlert } from "./ops-alerts.js";

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
