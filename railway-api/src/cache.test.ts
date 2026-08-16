import assert from "node:assert/strict";
import test from "node:test";
import { deletePattern, setRedisClientForTest } from "./cache.js";

test("Redis pattern delete falls back without throwing when scan fails", async () => {
  const fakeClient = {
    isOpen: true,
    async *scanIterator() {
      throw new Error("scan unavailable");
    },
    async del() {
      throw new Error("del should not run");
    },
  };

  await assert.doesNotReject(async () => {
    setRedisClientForTest(fakeClient as never);
    await deletePattern("leaderboard:*");
  });

  setRedisClientForTest(null);
});
