// functions/guest-registry.ts — temporary identities for players who have not
// registered.
//
// A guest is explicitly NOT a lightweight user account. The record below has no
// email, no password hash and no friends graph, and there is no code path that
// can add them — becoming permanent requires registering, which creates a real
// account in UserDirectory.
//
// Lifecycle:
//   issue    -> a slot number is taken from the recycle pool (or freshly minted)
//               and combined with a random nonce to form the guest id.
//   heartbeat-> the client slides `expiresAt` forward while it is active.
//   expire   -> an alarm sweep retires idle guests, returns the slot to the pool
//               for reuse, and drops their leaderboard rows.
//
// The nonce matters: recycling a bare slot number would let a stale client hold
// an id that a brand-new guest now owns. Slot recycling gives us short, reusable
// ids; the nonce keeps them unambiguous.

import { DurableObject } from "cloudflare:workers";
import {
  applyOutcome,
  applyRank,
  emptyStats,
  GUEST_SWEEP_MS,
  GUEST_TTL_MS,
  normalizeStats,
  type GuestSessionDto,
  type MatchOutcome,
  type PlayerStats,
} from "./identity";
import { mintSessionToken, sha256Hex } from "./auth-core";
import { callDo, callDoJson, LEADERBOARD_ID, type DoEnv } from "./do-dispatch";

/**
 * Session-scoped guest state. Note what is absent by design: no email, no
 * password, no friends, no permanent identity.
 */
type GuestSession = {
  guestId: string;
  slot: number;
  displayName: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  guestSecretHash: string;
  /** Temporary counters. These die with the session unless transferred. */
  stats: PlayerStats;
};

const SLOT_POOL_KEY = "free-slots";
const NEXT_SLOT_KEY = "next-slot";
const MAX_POOLED_SLOTS = 5_000;

export class GuestRegistry extends DurableObject<DoEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    try {
      switch (`${request.method} ${url.pathname}`) {
        case "POST /guest/session":
          return await this.issueOrRenew(request);
        case "POST /guest/heartbeat":
          return await this.heartbeat(request);
        case "POST /guest/end":
          return await this.endSession(request);
        case "GET /guest/me":
          return await this.currentSession(request, url);
        case "GET /internal/guest/resolve":
          return await this.resolveGuest(request);
        case "POST /internal/guest/claim":
          return await this.claim(request);
        case "POST /internal/report":
          return await this.report(request);
        default:
          return json({ error: "not_found" }, 404);
      }
    } catch (error) {
      console.error("GuestRegistry failure", url.pathname, (error as Error)?.message);
      return json({ error: "internal_error", message: "Something went wrong." }, 500);
    }
  }

  /**
   * Issues a fresh guest id, or renews the supplied one if it is still alive.
   * Called on app start, so a returning player inside the TTL keeps their run.
   */
  private async issueOrRenew(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const requestedName = sanitizeGuestName(body.displayName);
    const existingId = typeof body.guestId === "string" ? body.guestId : null;
    const existingSecret = typeof body.guestSecret === "string" ? body.guestSecret : null;

    if (existingId) {
      const existing = await this.ctx.storage.get<GuestSession>(key(existingId));
      if (existing && existing.expiresAt > Date.now() && await validGuestSecret(existing, existingSecret)) {
        existing.lastSeenAt = Date.now();
        existing.expiresAt = existing.lastSeenAt + GUEST_TTL_MS;
        if (requestedName) existing.displayName = requestedName;
        await this.ctx.storage.put(key(existingId), existing);
        await this.armSweep();
        return json({ guest: toDto(existing), reused: true });
      }
    }

    const session = await this.ctx.blockConcurrencyWhile(async () => {
      const slot = await this.takeSlot();
      const now = Date.now();
      const secret = await mintSessionToken();
      const fresh: GuestSession = {
        guestId: `g${slot}-${nonce()}`,
        slot,
        displayName: requestedName || `Guest${slot}`,
        createdAt: now,
        lastSeenAt: now,
        expiresAt: now + GUEST_TTL_MS,
        guestSecretHash: secret.digest,
        stats: emptyStats(),
      };
      await this.ctx.storage.put(key(fresh.guestId), fresh);
      return { session: fresh, guestSecret: secret.token };
    });

    await this.armSweep();
    return json({ guest: toDto(session.session, session.guestSecret), reused: false }, 201);
  }

  private async heartbeat(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const guestId = typeof body.guestId === "string" ? body.guestId : "";
    const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : "";
    const session = await this.ctx.storage.get<GuestSession>(key(guestId));

    if (!session || session.expiresAt <= Date.now()) {
      return json({ error: "guest_expired", message: "This guest session has expired." }, 404);
    }
    if (!await validGuestSecret(session, guestSecret)) return json({ error: "unauthorized" }, 401);

    session.lastSeenAt = Date.now();
    session.expiresAt = session.lastSeenAt + GUEST_TTL_MS;
    await this.ctx.storage.put(key(guestId), session);
    return json({ guest: toDto(session) });
  }

  /** Explicit end-of-session: retires the id immediately rather than waiting. */
  private async endSession(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const guestId = typeof body.guestId === "string" ? body.guestId : "";
    const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : "";
    const session = await this.ctx.storage.get<GuestSession>(key(guestId));
    if (!session) return json({ ok: true, retired: false });
    if (!await validGuestSecret(session, guestSecret)) return json({ error: "unauthorized" }, 401);

    await this.retire(session);
    return json({ ok: true, retired: true });
  }

  private async currentSession(request: Request, _url: URL): Promise<Response> {
    const guestId = request.headers.get("X-Guest-Id")?.trim() || "";
    const guestSecret = request.headers.get("X-Guest-Secret")?.trim() || "";
    const session = await this.ctx.storage.get<GuestSession>(key(guestId));
    if (!session || session.expiresAt <= Date.now()) {
      return json({ error: "guest_expired" }, 404);
    }
    if (!await validGuestSecret(session, guestSecret)) return json({ error: "unauthorized" }, 401);
    return json({ guest: toDto(session) });
  }

  /** Internal: validates a guest id for the match socket handshake. */
  private async resolveGuest(request: Request): Promise<Response> {
    const guestId = request.headers.get("X-Guest-Id")?.trim() || "";
    const guestSecret = request.headers.get("X-Guest-Secret")?.trim() || "";
    const session = await this.ctx.storage.get<GuestSession>(key(guestId));
    if (!session || session.expiresAt <= Date.now()) {
      return json({ error: "guest_expired" }, 404);
    }
    if (!await validGuestSecret(session, guestSecret)) return json({ error: "unauthorized" }, 401);
    // Playing counts as activity.
    session.lastSeenAt = Date.now();
    session.expiresAt = session.lastSeenAt + GUEST_TTL_MS;
    await this.ctx.storage.put(key(guestId), session);
    return json({
      guestId: session.guestId,
      displayName: session.displayName,
      powerUpCharges: session.stats.powerUpCharges,
    });
  }

  /**
   * One-shot transfer of a guest's session stats into a new account. The guest
   * is retired in the same critical section, which is what makes the transfer
   * safe: the stats can never be claimed twice or keep accruing afterwards.
   */
  private async claim(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const guestId = typeof body.guestId === "string" ? body.guestId : "";
    const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : "";

    const claimed = await this.ctx.blockConcurrencyWhile(async () => {
      const session = await this.ctx.storage.get<GuestSession>(key(guestId));
      if (!session || session.expiresAt <= Date.now()) return null;
      if (!await validGuestSecret(session, guestSecret)) return null;
      await this.ctx.storage.delete(key(guestId));
      await this.releaseSlot(session.slot);
      return session;
    });

    if (!claimed) return json({ ok: false, stats: null });

    await this.dropFromLeaderboard(claimed.guestId);
    return json({ ok: true, stats: claimed.stats });
  }

  private async report(request: Request): Promise<Response> {
    const body = (await safeJson(request)) as { outcome?: MatchOutcome };
    const outcome = body.outcome;
    if (!outcome || outcome.subjectKind !== "GUEST") return json({ error: "bad_request" }, 400);

    const reportKey = `report:${outcome.matchId}:${outcome.subjectKind}:${outcome.subjectId}`;
    if (await this.ctx.storage.get(reportKey)) {
      return json({ ok: true, duplicate: true, stats: null });
    }

    const session = await this.ctx.storage.get<GuestSession>(key(outcome.subjectId));
    if (!session) return json({ error: "guest_expired" }, 404);

    session.stats = applyOutcome(session.stats, outcome);
    session.lastSeenAt = Date.now();
    session.expiresAt = session.lastSeenAt + GUEST_TTL_MS;

    // Guests earn leaderboard milestones too — they just lose them along with
    // the rest of the session unless they register and carry the stats over.
    const upsert = await callDoJson<{ worldRank: number | null }>(
      this.env,
      "Leaderboard",
      LEADERBOARD_ID,
      "/internal/upsert",
      {
        method: "POST",
        body: {
          subjectKind: "GUEST",
          subjectId: session.guestId,
          displayName: session.displayName,
          stats: session.stats,
          expiresAt: session.expiresAt,
        },
      },
    ).catch(() => null);

    session.stats = applyRank(session.stats, upsert?.worldRank ?? null);
    await this.ctx.storage.put({
      [key(session.guestId)]: session,
      [reportKey]: Date.now(),
    });

    return json({ ok: true, duplicate: false, stats: session.stats });
  }

  // -------------------------------------------------------------------- sweep

  override async alarm(): Promise<void> {
    const now = Date.now();
    const all = await this.ctx.storage.list<GuestSession>({ prefix: "guest:" });

    let remaining = 0;
    for (const session of all.values()) {
      if (session.expiresAt <= now) {
        await this.retire(session);
      } else {
        remaining += 1;
      }
    }

    // Keep sweeping only while guests exist, so an idle registry costs nothing.
    if (remaining > 0) {
      await this.env.DO.setAlarm?.("GuestRegistry", "main", now + GUEST_SWEEP_MS);
    }
  }

  private async armSweep(): Promise<void> {
    const setAlarm = this.env.DO.setAlarm;
    const getAlarm = this.env.DO.getAlarm;
    if (!setAlarm || !getAlarm) return;
    const existing = await getAlarm.call(this.env.DO, "GuestRegistry", "main").catch(() => null);
    if (existing === null || existing === undefined) {
      await setAlarm
        .call(this.env.DO, "GuestRegistry", "main", Date.now() + GUEST_SWEEP_MS)
        .catch(() => undefined);
    }
  }

  private async retire(session: GuestSession): Promise<void> {
    await this.ctx.storage.delete(key(session.guestId));
    await this.releaseSlot(session.slot);
    await this.dropFromLeaderboard(session.guestId);
  }

  private async dropFromLeaderboard(guestId: string): Promise<void> {
    await callDo(this.env, "Leaderboard", LEADERBOARD_ID, "/internal/drop", {
      method: "POST",
      body: { subjectKind: "GUEST", subjectId: guestId },
    }).catch(() => undefined);
  }

  // --------------------------------------------------------------- slot pool

  private async takeSlot(): Promise<number> {
    const pool = (await this.ctx.storage.get<number[]>(SLOT_POOL_KEY)) ?? [];
    const recycled = pool.pop();
    if (recycled !== undefined) {
      await this.ctx.storage.put(SLOT_POOL_KEY, pool);
      return recycled;
    }
    const next = (await this.ctx.storage.get<number>(NEXT_SLOT_KEY)) ?? 1000;
    await this.ctx.storage.put(NEXT_SLOT_KEY, next + 1);
    return next;
  }

  private async releaseSlot(slot: number): Promise<void> {
    const pool = (await this.ctx.storage.get<number[]>(SLOT_POOL_KEY)) ?? [];
    if (pool.includes(slot) || pool.length >= MAX_POOLED_SLOTS) return;
    pool.push(slot);
    await this.ctx.storage.put(SLOT_POOL_KEY, pool);
  }
}

// --------------------------------------------------------------------- utils

function key(guestId: string): string {
  return `guest:${guestId}`;
}

function nonce(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function toDto(session: GuestSession, guestSecret?: string): GuestSessionDto {
  return {
    kind: "GUEST",
    guestId: session.guestId,
    ...(guestSecret ? { guestSecret } : {}),
    displayName: session.displayName,
    expiresAt: session.expiresAt,
    stats: normalizeStats(session.stats),
  };
}

async function validGuestSecret(session: GuestSession, secret: string | null): Promise<boolean> {
  if (!secret || !session.guestSecretHash) return false;
  return await sha256Hex(secret) === session.guestSecretHash;
}

function sanitizeGuestName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 16);
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
