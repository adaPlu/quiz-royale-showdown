// functions/matchmaker.ts — public matchmaking plus a private-room directory.
//
// Public matchmaking keeps one singleton instance per game mode. Private room
// discovery reuses the same Durable Object class under PRIVATE_DIRECTORY_ID so
// room-code state remains strongly consistent without adding another binding.

import { DurableObject } from "cloudflare:workers";
import { MODE_CONFIG, type GameMode } from "./protocol";
import {
  buildPrivateRoomId,
  generateRoomCode,
  normalizeMatchDifficulty,
  normalizeRoomCode,
  type MatchDifficulty,
} from "./private-match";
import { enforceRateLimit } from "./rate-limit";

type Bucket = {
  roomId: string;
  playerCount: number;
  openedAt: number;
};

type PrivateRoomRecord = {
  code: string;
  roomId: string;
  hostId: string;
  mode: GameMode;
  difficulty: MatchDifficulty;
  createdAt: number;
  updatedAt: number;
};

export const PRIVATE_DIRECTORY_ID = "private-directory";
const BUCKET_KEY = "open-bucket";
const PRIVATE_ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const PRIVATE_ROOM_CREATE_ATTEMPTS = 12;

export class Matchmaker extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/private/")) return this.handlePrivateRequest(request, url);

    const mode = parseMode(this.ctx.id.name ?? url.searchParams.get("mode"));
    const cfg = MODE_CONFIG[mode];

    const rateLimitOnly = request.headers.get("X-Quiz-Rate-Limit-Only")?.trim();
    const action = rateLimitOnly === "socket-ticket" ? "socket-ticket" : "matchmake";
    const limited = await enforceRateLimit(
      this.ctx,
      request,
      action,
      action === "socket-ticket"
        ? { max: 60, windowMs: 60_000 }
        : { max: 30, windowMs: 60_000 },
    );
    if (limited) return limited;
    if (rateLimitOnly) return new Response(null, { status: 204 });

    const bucket = await this.ctx.storage.get<Bucket>(BUCKET_KEY);
    const now = Date.now();

    // A lobby stops accepting players once it is full or once its countdown
    // has run out — otherwise a late joiner would drop into a live match.
    const expired =
      !bucket ||
      bucket.playerCount >= cfg.maxPlayers ||
      now - bucket.openedAt > cfg.lobbyMs - 2_500;

    const next: Bucket = expired
      ? { roomId: `${mode.toLowerCase()}-${now.toString(36)}-${crypto.randomUUID().slice(0, 6)}`, playerCount: 1, openedAt: now }
      : { ...bucket, playerCount: bucket.playerCount + 1 };

    await this.ctx.storage.put(BUCKET_KEY, next);

    return Response.json({
      roomId: next.roomId,
      mode,
      playersWaiting: next.playerCount,
      lobbyEndsAt: next.openedAt + cfg.lobbyMs,
    });
  }

  private async handlePrivateRequest(request: Request, url: URL): Promise<Response> {
    const action = url.pathname === "/private/create" ? "private-create" : "private-room";
    const limited = await enforceRateLimit(
      this.ctx,
      request,
      action,
      action === "private-create" ? { max: 10, windowMs: 60_000 } : { max: 60, windowMs: 60_000 },
    );
    if (limited) return limited;

    if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });

    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }

    const hostId = typeof body.hostId === "string" ? body.hostId.trim() : "";
    if (url.pathname === "/private/create") {
      if (!hostId) return Response.json({ error: "host_required" }, { status: 400 });
      return this.createPrivateRoom(hostId, parseMode(typeof body.mode === "string" ? body.mode : null), normalizeMatchDifficulty(body.difficulty));
    }

    const code = normalizeRoomCode(typeof body.code === "string" ? body.code : "");
    if (!code) return Response.json({ error: "invalid_room_code" }, { status: 400 });
    const current = await this.loadPrivateRoom(code);
    if (!current) return Response.json({ error: "room_not_found" }, { status: 404 });

    if (url.pathname === "/private/join") return Response.json(current);

    if (url.pathname === "/private/update") {
      if (!hostId || hostId !== current.hostId) return Response.json({ error: "host_required" }, { status: 403 });
      const mode = parseMode(typeof body.mode === "string" ? body.mode : current.mode);
      const difficulty = normalizeMatchDifficulty(body.difficulty ?? current.difficulty);
      const updated: PrivateRoomRecord = {
        ...current,
        roomId: buildPrivateRoomId(code, mode, difficulty),
        mode,
        difficulty,
        updatedAt: Date.now(),
      };
      await this.ctx.storage.put(privateRoomKey(code), updated);
      return Response.json(updated);
    }

    return Response.json({ error: "not_found" }, { status: 404 });
  }

  private async createPrivateRoom(hostId: string, mode: GameMode, difficulty: MatchDifficulty): Promise<Response> {
    const now = Date.now();
    for (let attempt = 0; attempt < PRIVATE_ROOM_CREATE_ATTEMPTS; attempt += 1) {
      const code = generateRoomCode();
      const existing = await this.loadPrivateRoom(code);
      if (existing) continue;
      const room: PrivateRoomRecord = {
        code,
        roomId: buildPrivateRoomId(code, mode, difficulty),
        hostId,
        mode,
        difficulty,
        createdAt: now,
        updatedAt: now,
      };
      await this.ctx.storage.put(privateRoomKey(code), room);
      return Response.json(room, { status: 201 });
    }
    return Response.json({ error: "room_code_capacity" }, { status: 503 });
  }

  private async loadPrivateRoom(code: string): Promise<PrivateRoomRecord | null> {
    const key = privateRoomKey(code);
    const room = await this.ctx.storage.get<PrivateRoomRecord>(key);
    if (!room) return null;
    if (Date.now() - room.updatedAt <= PRIVATE_ROOM_TTL_MS) return room;
    await this.ctx.storage.delete(key);
    return null;
  }
}

function privateRoomKey(code: string): string {
  return `private:${code}`;
}

function parseMode(raw: string | null): GameMode {
  if (raw === "TOURNAMENT" || raw === "PRACTICE" || raw === "QUICK") return raw;
  return "QUICK";
}
