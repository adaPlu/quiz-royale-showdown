import assert from "node:assert/strict";
import test from "node:test";
import { applyOutcome, derivePresence, emptyStats, mergeStats, publicLeaderboardSubjectId } from "./identity.js";

test("match outcomes update shared user and guest stat shape", () => {
  const next = applyOutcome(emptyStats(), {
    matchId: "match-1",
    subjectKind: "USER",
    subjectId: "u-1",
    displayName: "Alice",
    won: true,
    placement: 1,
    score: 120,
    correctAnswers: 6,
    powerUpsUsed: 1,
    categoryPoints: { Science: 80, History: 40 },
    recordWinLoss: true,
  });

  assert.equal(next.wins, 1);
  assert.equal(next.losses, 0);
  assert.equal(next.totalPoints, 120);
  assert.equal(next.powerUpCharges, 4);
  assert.equal(next.categoryPoints.Science, 80);
});


test("Practice outcomes do not mutate persistent competitive progression", () => {
  const base = {
    ...emptyStats(),
    wins: 3,
    losses: 2,
    matchesPlayed: 5,
    totalPoints: 900,
    bestScore: 400,
    bestPlacement: 1,
    correctAnswers: 30,
    powerUpsUsed: 2,
    powerUpCharges: 7,
    categoryPoints: { Science: 500 },
    bestRank: 12,
  };

  const next = applyOutcome(base, {
    matchId: "practice-1",
    subjectKind: "USER",
    subjectId: "u-1",
    displayName: "Alice",
    won: true,
    placement: 1,
    score: 9999,
    correctAnswers: 10,
    powerUpsUsed: 2,
    categoryPoints: { Science: 9999 },
    recordWinLoss: false,
    competitiveRewards: false,
  });

  assert.deepEqual(next, base);
});

test("guest transfer merges stats exactly once into registered stats", () => {
  const guest = applyOutcome(emptyStats(), {
    matchId: "match-2",
    subjectKind: "GUEST",
    subjectId: "g1000-abc123",
    displayName: "Guest1000",
    won: false,
    placement: 3,
    score: 55,
    correctAnswers: 2,
    powerUpsUsed: 0,
    categoryPoints: { Sports: 55 },
    recordWinLoss: true,
  });
  const merged = mergeStats(emptyStats(), guest);

  assert.equal(merged.losses, 1);
  assert.equal(merged.totalPoints, 55);
  assert.equal(merged.categoryPoints.Sports, 55);
});

test("presence drops stale in-match claims", () => {
  const now = 1_000_000;

  assert.equal(derivePresence({ lastSeenAt: now, status: "IN_MATCH", matchMode: "QUICK", statusAt: now }, now).presence, "IN_MATCH");
  assert.equal(derivePresence({ lastSeenAt: 1, status: "IN_MATCH", matchMode: "QUICK", statusAt: 1 }, now).presence, "OFFLINE");
});

test("leaderboard public ids do not expose guest bearer ids", () => {
  assert.equal(publicLeaderboardSubjectId("USER", "u-1"), "u-1");
  assert.notEqual(publicLeaderboardSubjectId("GUEST", "g1000-abcdef123456"), "g1000-abcdef123456");
});
