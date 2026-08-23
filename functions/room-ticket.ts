import type { DoEnv } from "./do-dispatch";
import type { GameMode } from "./protocol";

const ROOM_TICKET_TTL_MS = 30 * 60 * 1000;
const encoder = new TextEncoder();

export async function mintRoomTicket(
  env: DoEnv,
  roomId: string,
  mode: GameMode,
  now = Date.now(),
): Promise<string | null> {
  const secret = ticketSecret(env);
  if (!secret) return null;

  const expiresAt = now + ROOM_TICKET_TTL_MS;
  const payload = `${roomId}.${mode}.${expiresAt}.${crypto.randomUUID()}`;
  const signature = await sign(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifyRoomTicket(
  env: DoEnv,
  ticket: string | null,
  roomId: string,
  mode: GameMode,
  now = Date.now(),
): Promise<boolean> {
  const secret = ticketSecret(env);
  if (!secret || !ticket) return false;

  const parts = ticket.split(".");
  if (parts.length !== 5) return false;
  const [ticketRoomId, ticketMode, rawExpiresAt] = parts;
  if (ticketRoomId !== roomId || ticketMode !== mode) return false;

  const expiresAt = Number.parseInt(rawExpiresAt ?? "", 10);
  if (!Number.isFinite(expiresAt) || expiresAt < now) return false;

  const payload = parts.slice(0, 4).join(".");
  const expected = await sign(secret, payload);
  return expected === parts[4];
}

function ticketSecret(env: DoEnv): string | null {
  return env.MATCH_ROOM_TICKET_SECRET?.trim() || env.RAILWAY_INTERNAL_TOKEN?.trim() || null;
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(signature);
}

function base64Url(buffer: ArrayBuffer): string {
  let raw = "";
  for (const byte of new Uint8Array(buffer)) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
