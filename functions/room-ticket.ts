import type { DoEnv } from "./do-dispatch";
import type { GameMode } from "./protocol";

const ROOM_TICKET_TTL_MS = 30 * 60 * 1000;
const SOCKET_TICKET_TTL_MS = 2 * 60 * 1000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export type SocketIdentity = {
  kind: "USER" | "GUEST";
  subjectId: string;
  displayName: string;
  powerUpCharges: number;
};

type SocketTicketPayload = SocketIdentity & {
  roomId: string;
  mode: GameMode;
  expiresAt: number;
  nonce: string;
};

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

/**
 * Browsers cannot attach arbitrary Authorization/X-Guest headers to the WebSocket
 * handshake. Exchange those normal HTTP credentials for this short-lived signed
 * ticket first, then send only the ticket in the socket URL.
 */
export async function mintSocketTicket(
  env: DoEnv,
  roomId: string,
  mode: GameMode,
  identity: SocketIdentity,
  now = Date.now(),
): Promise<string | null> {
  const secret = ticketSecret(env);
  if (!secret) return null;

  const payload: SocketTicketPayload = {
    roomId,
    mode,
    kind: identity.kind,
    subjectId: identity.subjectId,
    displayName: identity.displayName,
    powerUpCharges: identity.powerUpCharges,
    expiresAt: now + SOCKET_TICKET_TTL_MS,
    nonce: crypto.randomUUID(),
  };
  const encoded = base64Url(encoder.encode(JSON.stringify(payload)).buffer);
  const signature = await sign(secret, encoded);
  return `${encoded}.${signature}`;
}

export async function verifySocketTicket(
  env: DoEnv,
  ticket: string | null,
  roomId: string,
  mode: GameMode,
  now = Date.now(),
): Promise<SocketIdentity | null> {
  const secret = ticketSecret(env);
  if (!secret || !ticket) return null;

  const parts = ticket.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts;
  if (!encoded || !signature) return null;
  if ((await sign(secret, encoded)) !== signature) return null;

  const payload = decodeSocketPayload(encoded);
  if (!payload) return null;
  if (payload.roomId !== roomId || payload.mode !== mode || payload.expiresAt < now) return null;
  if (payload.kind !== "USER" && payload.kind !== "GUEST") return null;
  if (!payload.subjectId || !payload.displayName || !Number.isFinite(payload.powerUpCharges)) return null;

  return {
    kind: payload.kind,
    subjectId: payload.subjectId,
    displayName: payload.displayName,
    powerUpCharges: payload.powerUpCharges,
  };
}

function decodeSocketPayload(encoded: string): SocketTicketPayload | null {
  try {
    const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const raw = atob(padded);
    const bytes = new Uint8Array(raw.length);
    for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
    return JSON.parse(decoder.decode(bytes)) as SocketTicketPayload;
  } catch {
    return null;
  }
}

function ticketSecret(env: DoEnv): string | null {
  const explicit = env.MATCH_ROOM_TICKET_SECRET?.trim();
  if (explicit) return explicit;
  if (isProduction(env)) return null;
  return env.RAILWAY_INTERNAL_TOKEN?.trim() || null;
}

function isProduction(env: DoEnv): boolean {
  return [env.ENVIRONMENT, env.NODE_ENV, env.APP_ENV]
    .some((value) => value?.trim().toLowerCase() === "production");
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

function base64Url(buffer: ArrayBufferLike): string {
  let raw = "";
  for (const byte of new Uint8Array(buffer)) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
