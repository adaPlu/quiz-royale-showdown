import assert from "node:assert/strict";
import test from "node:test";
import { buildMatchRoomTargetUrl } from "./match-routing.ts";
import { incrementGuestName } from "./guest-names.ts";
import { mintRoomTicket, verifyRoomTicket } from "./room-ticket.ts";

test("room tickets reject missing malformed expired and mismatched credentials", async () => {
  const env = { MATCH_ROOM_TICKET_SECRET: "ticket-secret" };
  const valid = await mintRoomTicket(env, "room-a", "QUICK", 1_000);
  assert(valid);

  assert.equal(await verifyRoomTicket(env, null, "room-a", "QUICK", 1_001), false);
  assert.equal(await verifyRoomTicket(env, "not.a.valid.ticket", "room-a", "QUICK", 1_001), false);
  assert.equal(await verifyRoomTicket(env, valid, "room-b", "QUICK", 1_001), false);
  assert.equal(await verifyRoomTicket(env, valid, "room-a", "PRACTICE", 1_001), false);
  assert.equal(await verifyRoomTicket(env, valid, "room-a", "QUICK", 31 * 60 * 1_000), false);
});

test("room tickets accept valid room and mode before expiry", async () => {
  const env = { MATCH_ROOM_TICKET_SECRET: "ticket-secret" };
  const ticket = await mintRoomTicket(env, "room-a", "QUICK", 1_000);
  assert(ticket);
  assert.equal(await verifyRoomTicket(env, ticket, "room-a", "QUICK", 2_000), true);
});

test("production ticket minting requires explicit match room secret", async () => {
  assert.equal(await mintRoomTicket({ ENVIRONMENT: "production", RAILWAY_INTERNAL_TOKEN: "shared" }, "room-a", "QUICK"), null);
  assert.notEqual(await mintRoomTicket({ RAILWAY_INTERNAL_TOKEN: "shared" }, "room-a", "QUICK"), null);
});

test("match room target overwrites spoofed client identity query parameters", () => {
  const target = new URL(buildMatchRoomTargetUrl(
    "https://worker.example/match/room-a?playerId=attacker&name=Evil&kind=USER&powerUpCharges=999&roomTicket=t",
    "room-a",
    "QUICK",
    { kind: "GUEST", subjectId: "g1001-real", displayName: "Challenger01", powerUpCharges: 2 },
  ));

  assert.equal(target.pathname, "/room/room-a");
  assert.equal(target.searchParams.get("playerId"), "g1001-real");
  assert.equal(target.searchParams.get("name"), "Challenger01");
  assert.equal(target.searchParams.get("kind"), "GUEST");
  assert.equal(target.searchParams.get("mode"), "QUICK");
  assert.equal(target.searchParams.get("powerUpCharges"), "2");
  assert.equal(target.searchParams.has("roomTicket"), false);
});

test("guest display-name suffixing preserves challenger sequence formatting", () => {
  assert.equal(incrementGuestName("Challenger00", 1), "Challenger01");
  assert.equal(incrementGuestName("Challenger00", 1_001), "Challenger1001");
  assert.equal(incrementGuestName("Challenger99", 1), "Challenger100");
});
