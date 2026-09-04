import type { GameMode } from "./protocol";

export type PrivateMatchAction = "create" | "join" | "update";
export type PrivateMatchIdentity = { subjectId: string };
export type MatchDifficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED";

type DirectoryResult = {
  status: number;
  body: Record<string, unknown>;
};

type DirectoryCall = (path: string, body: Record<string, unknown>) => Promise<DirectoryResult>;
type TicketMint = (roomId: string, mode: GameMode) => Promise<string | null>;

export async function handlePrivateMatchAction(
  action: PrivateMatchAction,
  input: Record<string, unknown>,
  identity: PrivateMatchIdentity,
  callDirectory: DirectoryCall,
  mintTicket: TicketMint,
): Promise<Response> {
  const forwarded = trustedDirectoryInput(action, input, identity);
  const result = await callDirectory(`/private/${action}`, forwarded);
  if (result.status < 200 || result.status >= 300) return Response.json(result.body, { status: result.status });

  const roomId = typeof result.body.roomId === "string" ? result.body.roomId : "";
  const mode = parseMode(result.body.mode);
  if (!roomId || !mode) return Response.json({ error: "private_room_invalid" }, { status: 502 });
  const roomTicket = await mintTicket(roomId, mode);
  if (!roomTicket) return Response.json({ error: "match_tickets_unavailable" }, { status: 503 });

  const publicBody: Record<string, unknown> = { ...result.body, roomTicket };
  delete publicBody.hostId;
  return Response.json(publicBody, { status: result.status });
}

function trustedDirectoryInput(
  action: PrivateMatchAction,
  input: Record<string, unknown>,
  identity: PrivateMatchIdentity,
): Record<string, unknown> {
  if (action === "create") {
    return {
      mode: parseMode(input.mode) ?? "QUICK",
      difficulty: normalizeMatchDifficulty(input.difficulty),
      hostId: identity.subjectId,
    };
  }

  const body: Record<string, unknown> = {
    code: typeof input.code === "string" ? input.code : "",
  };
  if (action === "update") {
    body.mode = parseMode(input.mode) ?? "QUICK";
    body.difficulty = normalizeMatchDifficulty(input.difficulty);
    body.hostId = identity.subjectId;
  }
  return body;
}

function parseMode(value: unknown): GameMode | null {
  return value === "QUICK" || value === "TOURNAMENT" || value === "PRACTICE" ? value : null;
}

function normalizeMatchDifficulty(value: unknown): MatchDifficulty {
  return value === "EASY" || value === "MEDIUM" || value === "HARD" || value === "MIXED" ? value : "MIXED";
}

export function normalizePrivateMatchSettings(input: Record<string, unknown>): {
  mode: GameMode;
  difficulty: MatchDifficulty;
} {
  return {
    mode: parseMode(input.mode) ?? "QUICK",
    difficulty: normalizeMatchDifficulty(input.difficulty),
  };
}
