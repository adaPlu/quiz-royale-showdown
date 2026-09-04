import assert from "node:assert/strict";
import test from "node:test";
import { handlePrivateMatchAction } from "./private-match-api.ts";

test("create injects trusted subject id and returns a signed room assignment", async () => {
  let forwarded: Record<string, unknown> | null = null;
  const response = await handlePrivateMatchAction(
    "create",
    { mode: "TOURNAMENT", difficulty: "HARD" },
    { subjectId: "user-123" },
    async (_path, body) => {
      forwarded = body;
      return {
        status: 201,
        body: {
          code: "AB2CD3",
          roomId: "private-AB2CD3-tournament-hard-nonce",
          hostId: "user-123",
          mode: "TOURNAMENT",
          difficulty: "HARD",
          createdAt: 1,
          updatedAt: 1,
        },
      };
    },
    async (roomId, mode) => `${roomId}.${mode}.ticket`,
  );
  assert.deepEqual(forwarded, { mode: "TOURNAMENT", difficulty: "HARD", hostId: "user-123" });
  assert.equal(response.status, 201);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.hostId, undefined);
  assert.equal(body.roomTicket, "private-AB2CD3-tournament-hard-nonce.TOURNAMENT.ticket");
});

test("join does not trust a client-supplied host id", async () => {
  let forwarded: Record<string, unknown> | null = null;
  const response = await handlePrivateMatchAction(
    "join",
    { code: "ab2-cd3", hostId: "attacker" },
    { subjectId: "guest-9" },
    async (_path, body) => {
      forwarded = body;
      return {
        status: 200,
        body: {
          code: "AB2CD3",
          roomId: "private-AB2CD3-quick-mixed-nonce",
          hostId: "real-host",
          mode: "QUICK",
          difficulty: "MIXED",
          createdAt: 1,
          updatedAt: 1,
        },
      };
    },
    async () => "ticket",
  );
  assert.deepEqual(forwarded, { code: "ab2-cd3" });
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.hostId, undefined);
  assert.equal(body.roomTicket, "ticket");
});

test("update uses trusted caller identity for host authorization", async () => {
  let forwarded: Record<string, unknown> | null = null;
  const response = await handlePrivateMatchAction(
    "update",
    { code: "AB2CD3", mode: "QUICK", difficulty: "EASY", hostId: "attacker" },
    { subjectId: "real-host" },
    async (_path, body) => {
      forwarded = body;
      return {
        status: 403,
        body: { error: "host_required" },
      };
    },
    async () => "unused",
  );
  assert.deepEqual(forwarded, { code: "AB2CD3", mode: "QUICK", difficulty: "EASY", hostId: "real-host" });
  assert.equal(response.status, 403);
});
