// functions/matchmaker.ts — one singleton instance per game mode.
//
// Plain HTTP (no WebSocket): the client asks for a room id, then opens its
// match socket straight to that room. Keeping matchmaking off the socket path
// means a player never sits in a queue — they are placed into an open lobby
// immediately and the room itself runs the countdown.

import { DurableObject } from "cloudflare:workers";
import { MODE_CONFIG, type GameMode } from "./protocol";

type Bucket = {
  roomId: string;
  playerCount: number;
  openedAt: number;
};

const BUCKET_KEY = "open-bucket";

export class Matchmaker extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const mode = parseMode(this.ctx.id.name ?? url.searchParams.get("mode"));
    const cfg = MODE_CONFIG[mode];

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
}

function parseMode(raw: string | null): GameMode {
  if (raw === "TOURNAMENT" || raw === "PRACTICE" || raw === "QUICK") return raw;
  return "QUICK";
}
