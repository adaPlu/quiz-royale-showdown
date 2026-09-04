import assert from "node:assert/strict";
import test from "node:test";
import {
  buildPrivateRoomId,
  normalizeRoomCode,
  parsePrivateRoomId,
  questionDifficultyForMatch,
  type MatchDifficulty,
} from "./private-match.ts";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MODES = ["QUICK", "TOURNAMENT", "PRACTICE"] as const;
const DIFFICULTIES: MatchDifficulty[] = ["EASY", "MEDIUM", "HARD", "MIXED"];

function codeFor(index: number): string {
  let value = index;
  let code = "";
  for (let i = 0; i < 6; i += 1) {
    code = CODE_ALPHABET[value % CODE_ALPHABET.length] + code;
    value = Math.floor(value / CODE_ALPHABET.length);
  }
  return code;
}

test("bounded soak: 20000 private room ids round-trip without metadata drift", () => {
  for (let index = 0; index < 20_000; index += 1) {
    const code = codeFor(index);
    const mode = MODES[index % MODES.length];
    const difficulty = DIFFICULTIES[index % DIFFICULTIES.length];
    const nonce = index.toString(36).padStart(8, "0");
    const roomId = buildPrivateRoomId(code, mode, difficulty, nonce);

    assert.deepEqual(parsePrivateRoomId(roomId), { code, mode, difficulty });
    assert.equal(normalizeRoomCode(code.toLowerCase()), code);
  }
});

test("bounded adversarial corpus rejects ambiguous malformed and forged room ids", () => {
  const invalidCodes = [
    "", "ABCDE", "ABCDEFG", "ABO0I1", "AB-CD3", "!!!!!!", "000000", "IIIIII", "OOOOOO",
  ];
  for (const code of invalidCodes) assert.equal(normalizeRoomCode(code), null);

  const forgedIds = [
    "private-AB2CD3-quick-impossible-nonce",
    "private-AB2CD3-admin-hard-nonce",
    "private-AB2CD3-quick-hard",
    "public-AB2CD3-quick-hard-nonce",
    "private-ABO0I1-quick-hard-nonce",
  ];
  for (const roomId of forgedIds) assert.equal(parsePrivateRoomId(roomId), null);
});

test("difficulty mapping remains deterministic under repeated mixed-mode selection", () => {
  for (let index = 0; index < 25_000; index += 1) {
    assert.equal(questionDifficultyForMatch("EASY"), "easy");
    assert.equal(questionDifficultyForMatch("MEDIUM"), "medium");
    assert.equal(questionDifficultyForMatch("HARD"), "hard");
    assert.equal(questionDifficultyForMatch("MIXED"), null);
  }
});
