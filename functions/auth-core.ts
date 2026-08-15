// functions/auth-core.ts — password hashing, credential validation and session
// token minting. Deliberately dependency-free: everything here runs on the
// WebCrypto primitives the Workers runtime already exposes.
//
// Security posture:
//   * Passwords are NEVER stored or logged. Only a PBKDF2-SHA256 derivation is
//     persisted, with a per-user random salt and a tunable cost.
//   * The stored string carries its own parameters, so the cost can be raised
//     later and old hashes still verify (and get transparently upgraded).
//   * Session tokens are random 256-bit values. Only their SHA-256 digest is
//     stored, so a storage leak cannot be replayed as a live session.
//   * Verification uses a constant-time comparison to avoid timing oracles.

/**
 * The Workers runtime hard-caps a single PBKDF2 call at 100k iterations, which
 * sits below current OWASP guidance for PBKDF2-SHA256. We therefore CHAIN
 * several capped derivations: each round feeds its output in as the next round's
 * input material, with the round index mixed into the salt. The rounds must be
 * run sequentially, so the real work factor is the product below — not 100k.
 */
export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_ROUNDS = 4;

/** Effective work factor. Used to decide whether a stored hash needs upgrading. */
export const PBKDF2_EFFECTIVE = PBKDF2_ITERATIONS * PBKDF2_ROUNDS;

const SALT_BYTES = 16;
const KEY_BITS = 256;
const TOKEN_BYTES = 32;

const encoder = new TextEncoder();

// ------------------------------------------------------------------ hashing

/**
 * Derives a password hash in the portable format
 * `pbkdf2-sha256$<rounds>x<iterations>$<saltB64>$<hashB64>`.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const bits = await deriveBits(password, salt, PBKDF2_ITERATIONS, PBKDF2_ROUNDS);
  const params = `${PBKDF2_ROUNDS}x${PBKDF2_ITERATIONS}`;
  return `pbkdf2-sha256$${params}$${toBase64(salt)}$${toBase64(new Uint8Array(bits))}`;
}

/**
 * Verifies [password] against a stored hash. Returns `needsRehash` when the
 * stored record used a weaker cost than current policy so the caller can
 * silently upgrade it after a successful login.
 */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") {
    return { valid: false, needsRehash: false };
  }

  const { rounds, iterations } = parseParams(parts[1]!);
  if (rounds < 1 || iterations < 1_000) {
    return { valid: false, needsRehash: false };
  }

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]!);
    expected = fromBase64(parts[3]!);
  } catch {
    return { valid: false, needsRehash: false };
  }

  const actual = new Uint8Array(await deriveBits(password, salt, iterations, rounds));
  const valid = timingSafeEqual(actual, expected);
  return { valid, needsRehash: valid && rounds * iterations < PBKDF2_EFFECTIVE };
}

/** Parses `<rounds>x<iterations>`, tolerating a bare legacy iteration count. */
function parseParams(raw: string): { rounds: number; iterations: number } {
  const [a, b] = raw.split("x");
  if (b === undefined) {
    return { rounds: 1, iterations: Number.parseInt(a ?? "", 10) || 0 };
  }
  return {
    rounds: Number.parseInt(a ?? "", 10) || 0,
    iterations: Number.parseInt(b, 10) || 0,
  };
}

/**
 * Sequentially chained PBKDF2. Each round stays under the runtime's per-call
 * iteration cap; chaining multiplies the total work an attacker must perform.
 */
async function deriveBits(
  password: string,
  salt: Uint8Array,
  iterations: number,
  rounds: number,
): Promise<ArrayBuffer> {
  let material: Uint8Array = encoder.encode(password);
  let output: ArrayBuffer | null = null;

  for (let round = 0; round < rounds; round++) {
    const key = await crypto.subtle.importKey("raw", material as BufferSource, "PBKDF2", false, [
      "deriveBits",
    ]);

    // Mixing the round index into the salt keeps each round's domain distinct.
    const roundSalt = new Uint8Array(salt.byteLength + 1);
    roundSalt.set(salt, 0);
    roundSalt[salt.byteLength] = round;

    output = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt: roundSalt as BufferSource, iterations, hash: "SHA-256" },
      key,
      KEY_BITS,
    );
    material = new Uint8Array(output);
  }

  if (!output) throw new Error("pbkdf2 requires at least one round");
  return output;
}

/** Length-independent, branch-free byte comparison. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

// ------------------------------------------------------------------- tokens

/** Mints a new opaque session token plus the digest that should be stored. */
export async function mintSessionToken(): Promise<{ token: string; digest: string }> {
  const raw = crypto.getRandomValues(new Uint8Array(TOKEN_BYTES));
  const token = toBase64Url(raw);
  return { token, digest: await sha256Hex(token) };
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// --------------------------------------------------------------- validation

export type FieldErrors = Record<string, string>;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const USERNAME_RE = /^[A-Za-z0-9_]+$/;
// Pragmatic, deliberately not RFC-5322-complete: one @, a dotted domain, no
// whitespace. Anything stricter rejects real addresses.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "system", "server", "moderator", "mod",
  "support", "help", "official", "quizroyale", "guest", "anonymous", "null",
  "undefined", "me", "you", "bot",
]);

/** Guest and bot shapes are reserved so a human cannot impersonate them. */
const RESERVED_PREFIXES = ["guest-", "g-", "bot-"];

const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "letmein1", "iloveyou", "abc12345", "football1", "baseball1",
  "trustno1", "welcome1", "admin123", "passw0rd", "quizroyale",
]);

export function validateUsername(raw: unknown): { value: string; error?: string } {
  if (typeof raw !== "string") return { value: "", error: "Username is required." };
  const value = raw.trim();

  if (value.length === 0) return { value, error: "Username is required." };
  if (value.length < USERNAME_MIN) {
    return { value, error: `Username must be at least ${USERNAME_MIN} characters.` };
  }
  if (value.length > USERNAME_MAX) {
    return { value, error: `Username must be at most ${USERNAME_MAX} characters.` };
  }
  if (!USERNAME_RE.test(value)) {
    return { value, error: "Use only letters, numbers and underscores." };
  }
  const lower = value.toLowerCase();
  if (RESERVED_USERNAMES.has(lower)) {
    return { value, error: "That username is reserved." };
  }
  if (RESERVED_PREFIXES.some((p) => lower.startsWith(p))) {
    return { value, error: "That username prefix is reserved." };
  }
  return { value };
}

export function validateEmail(raw: unknown): { value: string; error?: string } {
  if (typeof raw !== "string") return { value: "", error: "Email is required." };
  const value = raw.trim().toLowerCase();

  if (value.length === 0) return { value, error: "Email is required." };
  if (value.length > 254) return { value, error: "That email is too long." };
  if (!EMAIL_RE.test(value)) return { value, error: "Enter a valid email address." };
  return { value };
}

export function validatePassword(
  raw: unknown,
  username?: string,
): { value: string; error?: string } {
  if (typeof raw !== "string") return { value: "", error: "Password is required." };
  const value = raw;

  if (value.length === 0) return { value: "", error: "Password is required." };
  if (value.length < PASSWORD_MIN) {
    return { value: "", error: `Password must be at least ${PASSWORD_MIN} characters.` };
  }
  if (value.length > PASSWORD_MAX) {
    return { value: "", error: `Password must be at most ${PASSWORD_MAX} characters.` };
  }
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    return { value: "", error: "Include at least one letter and one number." };
  }
  if (WEAK_PASSWORDS.has(value.toLowerCase())) {
    return { value: "", error: "That password is too common." };
  }
  if (username && username.length >= 3 && value.toLowerCase().includes(username.toLowerCase())) {
    return { value: "", error: "Password cannot contain your username." };
  }
  return { value };
}

// ------------------------------------------------------------------ base64

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
