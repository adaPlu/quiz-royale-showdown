import { createHash, pbkdf2 as pbkdf2Callback, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

export const PBKDF2_ITERATIONS = 100_000;
export const PBKDF2_ROUNDS = 4;
export const PBKDF2_EFFECTIVE = PBKDF2_ITERATIONS * PBKDF2_ROUNDS;

const pbkdf2 = promisify(pbkdf2Callback);
const SALT_BYTES = 16;
const KEY_BYTES = 32;
const TOKEN_BYTES = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await derive(password, salt, PBKDF2_ITERATIONS, PBKDF2_ROUNDS);
  return `pbkdf2-sha256$${PBKDF2_ROUNDS}x${PBKDF2_ITERATIONS}$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2-sha256") {
    return { valid: false, needsRehash: false };
  }
  const { rounds, iterations } = parseParams(parts[1] ?? "");
  if (rounds < 1 || iterations < 1_000) return { valid: false, needsRehash: false };

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(parts[2]!, "base64");
    expected = Buffer.from(parts[3]!, "base64");
  } catch {
    return { valid: false, needsRehash: false };
  }

  const actual = await derive(password, salt, iterations, rounds);
  const valid = actual.byteLength === expected.byteLength && timingSafeEqual(actual, expected);
  return { valid, needsRehash: valid && rounds * iterations < PBKDF2_EFFECTIVE };
}

async function derive(password: string, salt: Buffer, iterations: number, rounds: number): Promise<Buffer> {
  let material = Buffer.from(password);
  let output = Buffer.alloc(0);
  for (let round = 0; round < rounds; round++) {
    const roundSalt = Buffer.concat([salt, Buffer.from([round])]);
    output = await pbkdf2(material, roundSalt, iterations, KEY_BYTES, "sha256");
    material = output;
  }
  return output;
}

function parseParams(raw: string): { rounds: number; iterations: number } {
  const [a, b] = raw.split("x");
  if (b === undefined) return { rounds: 1, iterations: Number.parseInt(a ?? "", 10) || 0 };
  return {
    rounds: Number.parseInt(a ?? "", 10) || 0,
    iterations: Number.parseInt(b, 10) || 0,
  };
}

export async function mintSessionToken(): Promise<{ token: string; digest: string }> {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, digest: sha256Hex(token) };
}

export async function mintPasswordResetToken(): Promise<{ token: string; digest: string }> {
  return mintSessionToken();
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 16;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

const USERNAME_RE = /^[A-Za-z0-9_]+$/;
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "root", "system", "server", "moderator", "mod",
  "support", "help", "official", "quizroyale", "guest", "anonymous", "null",
  "undefined", "me", "you", "bot",
]);
const RESERVED_PREFIXES = ["guest-", "g-", "bot-"];
const WEAK_PASSWORDS = new Set([
  "password", "password1", "password123", "12345678", "123456789", "1234567890",
  "qwerty123", "letmein1", "iloveyou", "abc12345", "football1", "baseball1",
  "trustno1", "welcome1", "admin123", "passw0rd", "quizroyale",
]);

export type FieldErrors = Record<string, string>;

export function validateUsername(raw: unknown): { value: string; error?: string } {
  if (typeof raw !== "string") return { value: "", error: "Username is required." };
  const value = raw.trim();
  if (!value) return { value, error: "Username is required." };
  if (value.length < USERNAME_MIN) return { value, error: `Username must be at least ${USERNAME_MIN} characters.` };
  if (value.length > USERNAME_MAX) return { value, error: `Username must be at most ${USERNAME_MAX} characters.` };
  if (!USERNAME_RE.test(value)) return { value, error: "Use only letters, numbers and underscores." };
  const lower = value.toLowerCase();
  if (RESERVED_USERNAMES.has(lower)) return { value, error: "That username is reserved." };
  if (RESERVED_PREFIXES.some((p) => lower.startsWith(p))) return { value, error: "That username prefix is reserved." };
  return { value };
}

export function validateEmail(raw: unknown): { value: string; error?: string } {
  if (typeof raw !== "string") return { value: "", error: "Email is required." };
  const value = raw.trim().toLowerCase();
  if (!value) return { value, error: "Email is required." };
  if (value.length > 254) return { value, error: "That email is too long." };
  if (!EMAIL_RE.test(value)) return { value, error: "Enter a valid email address." };
  return { value };
}

export function validatePassword(raw: unknown, username?: string): { value: string; error?: string } {
  if (typeof raw !== "string") return { value: "", error: "Password is required." };
  const value = raw;
  if (!value) return { value: "", error: "Password is required." };
  if (value.length < PASSWORD_MIN) return { value: "", error: `Password must be at least ${PASSWORD_MIN} characters.` };
  if (value.length > PASSWORD_MAX) return { value: "", error: `Password must be at most ${PASSWORD_MAX} characters.` };
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return { value: "", error: "Include at least one letter and one number." };
  if (WEAK_PASSWORDS.has(value.toLowerCase())) return { value: "", error: "That password is too common." };
  if (username && username.length >= 3 && value.toLowerCase().includes(username.toLowerCase())) {
    return { value: "", error: "Password cannot contain your username." };
  }
  return { value };
}
