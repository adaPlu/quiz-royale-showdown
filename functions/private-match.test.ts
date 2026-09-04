import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrivateRoomId,
  normalizeRoomCode,
  parsePrivateRoomId,
  questionDifficultyForMatch,
  type MatchDifficulty,
} from "./private-match.ts";

test("room codes normalize to six uppercase unambiguous characters", () => {
  assert.equal(normalizeRoomCode(" ab2-cd3 "), "AB2CD3");
  assert.equal(normalizeRoomCode("ab2cd"), null);
  assert.equal(normalizeRoomCode("ABO0I1"), null);
});

test("private room ids preserve signed mode and difficulty metadata", () => {
  const difficulties: MatchDifficulty[] = ["EASY", "MEDIUM", "HARD", "MIXED"];
  for (const difficulty of difficulties) {
    const roomId = buildPrivateRoomId("AB2CD3", "TOURNAMENT", difficulty, "abcdef");
    assert.deepEqual(parsePrivateRoomId(roomId), {
      code: "AB2CD3",
      mode: "TOURNAMENT",
      difficulty,
    });
  }
});

test("explicit match difficulties map to Railway pools while MIXED preserves existing selection", () => {
  assert.equal(questionDifficultyForMatch("EASY"), "easy");
  assert.equal(questionDifficultyForMatch("MEDIUM"), "medium");
  assert.equal(questionDifficultyForMatch("HARD"), "hard");
  assert.equal(questionDifficultyForMatch("MIXED"), null);
});

test("normal public room ids do not parse as private room metadata", () => {
  assert.equal(parsePrivateRoomId("quick-abc-123"), null);
  assert.equal(parsePrivateRoomId("private-AB2CD3-quick-impossible-abc"), null);
});
