import assert from "node:assert/strict";
import test from "node:test";
import { competitiveRewardsForMode } from "./match-policy.ts";

test("Practice cannot persist competitive rewards", () => {
  assert.equal(competitiveRewardsForMode("PRACTICE"), false);
});

test("competitive modes retain persistent rewards", () => {
  assert.equal(competitiveRewardsForMode("QUICK"), true);
  assert.equal(competitiveRewardsForMode("TOURNAMENT"), true);
});
