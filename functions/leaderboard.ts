// functions/leaderboard.ts — the ranking store for BOTH identity kinds.
//
// Guests and registered users share one board so a guest's run is genuinely
// competitive, but every row is tagged with its `subjectKind` and a guest row
// additionally carries the `expiresAt` of its temporary id. That gives us two
// things the acceptance criteria need:
//
//   * The client can visibly mark provisional guest rows.
//   * A guest row is filtered out the moment its id lapses, and is deleted
//     outright when GuestRegistry retires the id — so an expired guest never
//     lingers at the top of the world board.
//
// Storage layout:
//   entry:USER:<userId>    BoardEntry
//   entry:GUEST:<guestId>  BoardEntry (with expiresAt)

import { DurableObject } from "cloudflare:workers";
import { CATEGORIES } from "./questions";
import type {
  LeaderboardDto,
  LeaderboardEntryDto,
  PlayerStats,
  SubjectKind,
} from "./identity";

type BoardEntry = {
  subjectKind: SubjectKind;
  subjectId: string;
  displayName: string;
  totalPoints: number;
  wins: number;
  losses: number;
  categoryPoints: Record<string, number>;
  updatedAt: number;
  /** Guests only: when the underlying temporary id lapses. */
  expiresAt?: number;
};

export const WORLD_BOARD = "WORLD";

const MAX_SCAN = 10_000;
const DEFAULT_LIMIT = 50;

export class Leaderboard extends DurableObject {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (`${request.method} ${url.pathname}`) {
        case "GET /leaderboard":
          return await this.read(url);
        case "GET /leaderboard/boards":
          return json({ boards: [WORLD_BOARD, ...CATEGORIES] });
        case "POST /internal/upsert":
          return await this.upsert(request);
        case "POST /internal/drop":
          return await this.drop(request);
        default:
          return json({ error: "not_found" }, 404);
      }
    } catch (error) {
      console.error("Leaderboard failure", url.pathname, (error as Error)?.message);
      return json({ error: "internal_error", message: "Something went wrong." }, 500);
    }
  }

  private async read(url: URL): Promise<Response> {
    const board = normalizeBoard(url.searchParams.get("board"));
    const limit = clamp(Number.parseInt(url.searchParams.get("limit") ?? "", 10) || DEFAULT_LIMIT, 1, 200);
    const viewerId = url.searchParams.get("subjectId");

    const ranked = await this.rankedFor(board);

    const entries: LeaderboardEntryDto[] = ranked.slice(0, limit).map((row, index) => ({
      rank: index + 1,
      subjectKind: row.entry.subjectKind,
      subjectId: row.entry.subjectId,
      displayName: row.entry.displayName,
      points: row.points,
      wins: row.entry.wins,
      isYou: row.entry.subjectId === viewerId,
    }));

    const yourIndex = viewerId ? ranked.findIndex((r) => r.entry.subjectId === viewerId) : -1;

    return json({
      board,
      entries,
      yourRank: yourIndex >= 0 ? yourIndex + 1 : null,
      yourPoints: yourIndex >= 0 ? ranked[yourIndex]!.points : 0,
      totalRanked: ranked.length,
    } satisfies LeaderboardDto);
  }

  /**
   * Loads every live entry and ranks it for [board]. Expired guest rows are
   * skipped and lazily deleted, which keeps the board honest even if the
   * registry's sweep has not fired yet.
   */
  private async rankedFor(board: string): Promise<{ entry: BoardEntry; points: number }[]> {
    const all = await this.ctx.storage.list<BoardEntry>({ prefix: "entry:", limit: MAX_SCAN });
    const now = Date.now();
    const stale: string[] = [];
    const rows: { entry: BoardEntry; points: number }[] = [];

    for (const [key, entry] of all) {
      if (entry.subjectKind === "GUEST" && entry.expiresAt !== undefined && entry.expiresAt <= now) {
        stale.push(key);
        continue;
      }
      const points =
        board === WORLD_BOARD ? entry.totalPoints : (entry.categoryPoints[board] ?? 0);
      if (points <= 0) continue;
      rows.push({ entry, points });
    }

    if (stale.length > 0) {
      await this.ctx.storage.delete(stale);
    }

    rows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.entry.wins !== a.entry.wins) return b.entry.wins - a.entry.wins;
      // Oldest record wins a dead heat, so ranks are stable between reads.
      return a.entry.updatedAt - b.entry.updatedAt;
    });

    return rows;
  }

  private async upsert(request: Request): Promise<Response> {
    const body = (await safeJson(request)) as {
      subjectKind?: SubjectKind;
      subjectId?: string;
      displayName?: string;
      stats?: PlayerStats;
      expiresAt?: number;
    };

    const { subjectKind, subjectId, displayName, stats } = body;
    if ((subjectKind !== "USER" && subjectKind !== "GUEST") || !subjectId || !stats) {
      return json({ error: "bad_request" }, 400);
    }

    const entry: BoardEntry = {
      subjectKind,
      subjectId,
      displayName: displayName ?? subjectId,
      totalPoints: stats.totalPoints,
      wins: stats.wins,
      losses: stats.losses,
      categoryPoints: stats.categoryPoints ?? {},
      updatedAt: Date.now(),
      ...(subjectKind === "GUEST" && typeof body.expiresAt === "number"
        ? { expiresAt: body.expiresAt }
        : {}),
    };

    await this.ctx.storage.put(`entry:${subjectKind}:${subjectId}`, entry);
    return json({ ok: true });
  }

  private async drop(request: Request): Promise<Response> {
    const body = (await safeJson(request)) as { subjectKind?: SubjectKind; subjectId?: string };
    if (!body.subjectKind || !body.subjectId) return json({ error: "bad_request" }, 400);
    await this.ctx.storage.delete(`entry:${body.subjectKind}:${body.subjectId}`);
    return json({ ok: true });
  }
}

// --------------------------------------------------------------------- utils

function normalizeBoard(raw: string | null): string {
  if (!raw || raw === WORLD_BOARD) return WORLD_BOARD;
  const match = CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  return match ?? WORLD_BOARD;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed = await request.json();
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}
