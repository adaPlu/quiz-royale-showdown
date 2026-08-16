import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, mintPasswordResetToken, sha256Hex, validatePassword, verifyPassword } from "./auth-core.js";

test("passwords verify against stored hashes without storing plaintext", async () => {
  const hash = await hashPassword("CorrectHorse9");

  assert.match(hash, /^pbkdf2-sha256\$/);
  assert.equal(hash.includes("CorrectHorse9"), false);
  assert.deepEqual(await verifyPassword("CorrectHorse9", hash), { valid: true, needsRehash: false });
  assert.equal((await verifyPassword("wrongPassword9", hash)).valid, false);
});

test("reset tokens are opaque and stored by digest", async () => {
  const first = await mintPasswordResetToken();
  const second = await mintPasswordResetToken();

  assert.notEqual(first.token, second.token);
  assert.equal(first.digest, sha256Hex(first.token));
  assert.notEqual(first.digest, first.token);
});

test("password validation rejects username reuse", () => {
  assert.equal(validatePassword("Alice12345", "alice").error, "Password cannot contain your username.");
  assert.equal(validatePassword("A-safe-phrase-9", "alice").error, undefined);
});
