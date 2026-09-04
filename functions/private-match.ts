import type { GameMode } from "./protocol";

export type MatchDifficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED";

export type PrivateRoomMetadata = {
  code: string;
  mode: GameMode;
  difficulty: MatchDifficulty;
};

const ROOM_CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const ROOM_CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/;

export function normalizeRoomCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return ROOM_CODE_RE.test(code) ? code : null;
}

export function generateRoomCode(): string {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  let code = "";
  for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length];
  return code;
}

export function normalizeMatchDifficulty(raw: unknown): MatchDifficulty {
  return raw === "EASY" || raw === "MEDIUM" || raw === "HARD" || raw === "MIXED" ? raw : "MIXED";
}

export function buildPrivateRoomId(
  code: string,
  mode: GameMode,
  difficulty: MatchDifficulty,
  nonce = crypto.randomUUID().slice(0, 8),
): string {
  const normalized = normalizeRoomCode(code);
  if (!normalized) throw new Error("invalid private room code");
  return `private-${normalized}-${mode.toLowerCase()}-${difficulty.toLowerCase()}-${nonce}`;
}

export function parsePrivateRoomId(roomId: string): PrivateRoomMetadata | null {
  const match = roomId.match(/^private-([2-9A-HJ-NP-Z]{6})-(quick|tournament|practice)-(easy|medium|hard|mixed)-[A-Za-z0-9_-]+$/);
  if (!match) return null;
  const mode = match[2]!.toUpperCase() as GameMode;
  const difficulty = match[3]!.toUpperCase() as MatchDifficulty;
  return { code: match[1]!, mode, difficulty };
}

export function questionDifficultyForMatch(difficulty: MatchDifficulty): "easy" | "medium" | "hard" | null {
  if (difficulty === "MIXED") return null;
  return difficulty.toLowerCase() as "easy" | "medium" | "hard";
}
