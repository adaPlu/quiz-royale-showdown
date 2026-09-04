import assert from "node:assert/strict";
import test from "node:test";
import {
  canUpdatePrivateRoom,
  createPrivateRoomCode,
  normalizePrivateRoomCode,
  parsePrivateRoomMode,
  PRIVATE_ROOM_TTL_MS,
  type PrivateRoomRecord,
} from "./private-room.ts";

test("private room codes normalize to six safe uppercase characters", () => {
  assert.equal(normalizePrivateRoomCode(" abcd23 "), "ABCD23");
  assert.equal(normalizePrivateRoomCode("AB-CD23"), "ABCD23");
  assert.equal(normalizePrivateRoomCode("ABC01O"), null);
  assert.equal(normalizePrivateRoomCode("ABCDE"), null);
  assert.equal(normalizePrivateRoomCode("ABCDEFG"), null);
});

test("private room code generation is deterministic with injected bytes", () => {
  assert.equal(createPrivateRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5])), "ABCDEF");
  assert.equal(createPrivateRoomCode(new Uint8Array([31, 30, 29, 28, 27, 26])), "987654");
});

test("private room modes reject practice and default invalid values to quick", () => {
  assert.equal(parsePrivateRoomMode("TOURNAMENT"), "TOURNAMENT");
  assert.equal(parsePrivateRoomMode("QUICK"), "QUICK");
  assert.equal(parsePrivateRoomMode("PRACTICE"), "QUICK");
  assert.equal(parsePrivateRoomMode("bogus"), "QUICK");
});

test("only the host may update an unjoined unexpired private room", () => {
  const now = 1_000_000;
  const room: PrivateRoomRecord = {
    code: "ABCDEF",
    roomId: "private-abcdef",
    hostSubjectId: "host-1",
    hostKind: "USER",
    mode: "QUICK",
    createdAt: now,
    updatedAt: now,
    expiresAt: now + PRIVATE_ROOM_TTL_MS,
    joinCount: 0,
  };

  assert.equal(canUpdatePrivateRoom(room, "host-1", now + 1), true);
  assert.equal(canUpdatePrivateRoom(room, "other", now + 1), false);
  assert.equal(canUpdatePrivateRoom({ ...room, joinCount: 1 }, "host-1", now + 1), false);
  assert.equal(canUpdatePrivateRoom(room, "host-1", room.expiresAt + 1), false);
});
