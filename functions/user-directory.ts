// functions/user-directory.ts — the registered-account store.
//
// A single Durable Object instance owns every account, which buys us strong
// consistency for the one thing that genuinely needs it: username and email
// uniqueness. A get-then-put across two keys is safe here because the DO is
// single-threaded, and the register path additionally runs its check-and-claim
// inside `blockConcurrencyWhile` so two simultaneous signups for the same
// username cannot both win.
//
// Storage layout:
//   user:<userId>        UserRecord (includes the password hash)
//   uname:<lowercase>    userId          — uniqueness index
//   email:<lowercase>    userId          — uniqueness index
//   sess:<sha256(token)> SessionRecord   — only the digest is stored

import { DurableObject } from "cloudflare:workers";
import {
  hashPassword,
  mintSessionToken,
  sha256Hex,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
  type FieldErrors,
} from "./auth-core";
import {
  applyOutcome,
  emptyStats,
  mergeStats,
  SESSION_TTL_MS,
  type AuthResultDto,
  type FriendDto,
  type MatchOutcome,
  type PlayerStats,
  type UserProfileDto,
} from "./identity";
import { callDo, callDoJson, GUEST_REGISTRY_ID, LEADERBOARD_ID, type DoEnv } from "./do-dispatch";

type UserRecord = {
  userId: string;
  username: string;
  usernameLower: string;
  email: string;
  passwordHash: string;
  createdAt: number;
  lastLoginAt: number;
  stats: PlayerStats;
  friends: { userId: string; addedAt: number }[];
};

type SessionRecord = {
  userId: string;
  expiresAt: number;
  createdAt: number;
};

const MAX_FRIENDS = 200;

export class UserDirectory extends DurableObject<DoEnv> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (`${request.method} ${path}`) {
        case "POST /auth/register":
          return await this.register(request);
        case "POST /auth/login":
          return await this.login(request);
        case "POST /auth/logout":
          return await this.logout(request);
        case "GET /auth/me":
          return await this.me(request);
        case "GET /auth/resolve":
          return await this.resolve(request);
        case "POST /friends/add":
          return await this.addFriend(request);
        case "POST /friends/remove":
          return await this.removeFriend(request);
        case "GET /users/search":
          return await this.searchUsers(url);
        case "POST /internal/report":
          return await this.report(request);
        default:
          return json({ error: "not_found" }, 404);
      }
    } catch (error) {
      // Never leak internals to the client; the message is deliberately generic.
      console.error("UserDirectory failure", path, (error as Error)?.message);
      return json({ error: "internal_error", message: "Something went wrong." }, 500);
    }
  }

  // ------------------------------------------------------------- registration

  private async register(request: Request): Promise<Response> {
    const body = await safeJson(request);

    const username = validateUsername(body.username);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password, username.value);

    const errors: FieldErrors = {};
    if (username.error) errors.username = username.error;
    if (email.error) errors.email = email.error;
    if (password.error) errors.password = password.error;
    if (Object.keys(errors).length > 0) {
      return json({ error: "validation_failed", fields: errors }, 400);
    }

    const usernameLower = username.value.toLowerCase();

    // Cheap pre-check so an obvious duplicate does not pay for a 210k-iteration
    // derivation. The authoritative check happens in the critical section.
    if (await this.ctx.storage.get<string>(`uname:${usernameLower}`)) {
      return json({ error: "validation_failed", fields: { username: "That username is taken." } }, 409);
    }
    if (await this.ctx.storage.get<string>(`email:${email.value}`)) {
      return json({ error: "validation_failed", fields: { email: "That email is already registered." } }, 409);
    }

    // Hash BEFORE the critical section: PBKDF2 is intentionally slow and must
    // not block other requests to this object.
    const passwordHash = await hashPassword(password.value);
    const userId = `u-${crypto.randomUUID()}`;
    const now = Date.now();

    const claim = await this.ctx.blockConcurrencyWhile(async () => {
      const takenName = await this.ctx.storage.get<string>(`uname:${usernameLower}`);
      if (takenName) return { ok: false as const, field: "username", message: "That username is taken." };
      const takenEmail = await this.ctx.storage.get<string>(`email:${email.value}`);
      if (takenEmail) {
        return { ok: false as const, field: "email", message: "That email is already registered." };
      }

      const record: UserRecord = {
        userId,
        username: username.value,
        usernameLower,
        email: email.value,
        passwordHash,
        createdAt: now,
        lastLoginAt: now,
        stats: emptyStats(),
        friends: [],
      };

      await this.ctx.storage.put({
        [`user:${userId}`]: record,
        [`uname:${usernameLower}`]: userId,
        [`email:${email.value}`]: userId,
      });
      return { ok: true as const, record };
    });

    if (!claim.ok) {
      return json({ error: "validation_failed", fields: { [claim.field]: claim.message } }, 409);
    }

    // Optional, one-shot guest carry-over. Claiming retires the guest id inside
    // the registry, so the same session can never be transferred twice.
    let transferred = false;
    const guestId = typeof body.guestId === "string" ? body.guestId : null;
    if (guestId && body.transferStats === true) {
      const claimed = await callDoJson<{ ok: boolean; stats: PlayerStats | null }>(
        this.env,
        "GuestRegistry",
        GUEST_REGISTRY_ID,
        "/internal/guest/claim",
        { method: "POST", body: { guestId } },
      );
      if (claimed?.ok && claimed.stats) {
        claim.record.stats = mergeStats(claim.record.stats, claimed.stats);
        await this.ctx.storage.put(`user:${userId}`, claim.record);
        transferred = true;
      }
    }

    await this.syncLeaderboard(claim.record);
    const session = await this.createSession(userId);

    return json(
      {
        token: session.token,
        expiresAt: session.expiresAt,
        profile: await this.toProfile(claim.record),
        transferredFromGuest: transferred,
      } satisfies AuthResultDto,
      201,
    );
  }

  // -------------------------------------------------------------------- login

  private async login(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";

    if (!identifier || !password) {
      return json({ error: "validation_failed", fields: { identifier: "Enter your login details." } }, 400);
    }

    // Accept either username or email at the same field.
    const key = identifier.includes("@")
      ? `email:${identifier.toLowerCase()}`
      : `uname:${identifier.toLowerCase()}`;
    const userId = await this.ctx.storage.get<string>(key);
    const record = userId ? await this.ctx.storage.get<UserRecord>(`user:${userId}`) : null;

    if (!record) {
      // Uniform failure: never reveal whether the account exists.
      return json({ error: "invalid_credentials", message: "Incorrect login details." }, 401);
    }

    const { valid, needsRehash } = await verifyPassword(password, record.passwordHash);
    if (!valid) {
      return json({ error: "invalid_credentials", message: "Incorrect login details." }, 401);
    }

    record.lastLoginAt = Date.now();
    if (needsRehash) record.passwordHash = await hashPassword(password);
    await this.ctx.storage.put(`user:${record.userId}`, record);

    const session = await this.createSession(record.userId);
    return json({
      token: session.token,
      expiresAt: session.expiresAt,
      profile: await this.toProfile(record),
      transferredFromGuest: false,
    } satisfies AuthResultDto);
  }

  private async logout(request: Request): Promise<Response> {
    const token = bearer(request);
    if (token) await this.ctx.storage.delete(`sess:${await sha256Hex(token)}`);
    return json({ ok: true });
  }

  private async me(request: Request): Promise<Response> {
    const record = await this.authenticate(request);
    if (!record) return json({ error: "unauthorized" }, 401);
    return json({ profile: await this.toProfile(record) });
  }

  /**
   * Internal: turns a bearer token into a trusted identity for the Worker to
   * stamp onto match sockets. Kept separate from /auth/me so the socket path
   * does not pay for friend hydration.
   */
  private async resolve(request: Request): Promise<Response> {
    const record = await this.authenticate(request);
    if (!record) return json({ error: "unauthorized" }, 401);
    return json({
      userId: record.userId,
      username: record.username,
      powerUpCharges: record.stats.powerUpCharges,
    });
  }

  // ------------------------------------------------------------------ friends

  private async addFriend(request: Request): Promise<Response> {
    const me = await this.authenticate(request);
    if (!me) return json({ error: "unauthorized" }, 401);

    const body = await safeJson(request);
    const raw = typeof body.username === "string" ? body.username.trim() : "";
    if (!raw) return json({ error: "validation_failed", message: "Enter a username." }, 400);

    const targetId = await this.ctx.storage.get<string>(`uname:${raw.toLowerCase()}`);
    const target = targetId ? await this.ctx.storage.get<UserRecord>(`user:${targetId}`) : null;
    if (!target) return json({ error: "not_found", message: "No player with that username." }, 404);
    if (target.userId === me.userId) {
      return json({ error: "invalid", message: "You cannot add yourself." }, 400);
    }
    if (me.friends.some((f) => f.userId === target.userId)) {
      return json({ error: "already_friends", message: `${target.username} is already a friend.` }, 409);
    }
    if (me.friends.length >= MAX_FRIENDS) {
      return json({ error: "limit_reached", message: "Your friends list is full." }, 409);
    }

    const now = Date.now();
    // Friendship is symmetric, so both records gain the edge.
    me.friends.push({ userId: target.userId, addedAt: now });
    target.friends.push({ userId: me.userId, addedAt: now });
    await this.ctx.storage.put({
      [`user:${me.userId}`]: me,
      [`user:${target.userId}`]: target,
    });

    return json({ ok: true, profile: await this.toProfile(me) });
  }

  private async removeFriend(request: Request): Promise<Response> {
    const me = await this.authenticate(request);
    if (!me) return json({ error: "unauthorized" }, 401);

    const body = await safeJson(request);
    const targetId = typeof body.userId === "string" ? body.userId : "";
    if (!targetId) return json({ error: "validation_failed", message: "Missing friend id." }, 400);

    me.friends = me.friends.filter((f) => f.userId !== targetId);
    const updates: Record<string, unknown> = { [`user:${me.userId}`]: me };

    const target = await this.ctx.storage.get<UserRecord>(`user:${targetId}`);
    if (target) {
      target.friends = target.friends.filter((f) => f.userId !== me.userId);
      updates[`user:${targetId}`] = target;
    }
    await this.ctx.storage.put(updates);

    return json({ ok: true, profile: await this.toProfile(me) });
  }

  private async searchUsers(url: URL): Promise<Response> {
    const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
    if (q.length < 2) return json({ results: [] });

    const index = await this.ctx.storage.list<string>({ prefix: "uname:", limit: 1_000 });
    const matches: { userId: string; username: string }[] = [];
    for (const [key, userId] of index) {
      const name = key.slice("uname:".length);
      if (!name.includes(q)) continue;
      const record = await this.ctx.storage.get<UserRecord>(`user:${userId}`);
      if (record) matches.push({ userId: record.userId, username: record.username });
      if (matches.length >= 20) break;
    }
    return json({ results: matches });
  }

  // -------------------------------------------------------------- match stats

  private async report(request: Request): Promise<Response> {
    const body = (await safeJson(request)) as { outcome?: MatchOutcome };
    const outcome = body.outcome;
    if (!outcome || outcome.subjectKind !== "USER") return json({ error: "bad_request" }, 400);

    const record = await this.ctx.storage.get<UserRecord>(`user:${outcome.subjectId}`);
    if (!record) return json({ error: "not_found" }, 404);

    record.stats = applyOutcome(record.stats, outcome);
    await this.ctx.storage.put(`user:${record.userId}`, record);
    await this.syncLeaderboard(record);

    return json({ ok: true, stats: record.stats });
  }

  // ------------------------------------------------------------------ helpers

  private async authenticate(request: Request): Promise<UserRecord | null> {
    const token = bearer(request);
    if (!token) return null;

    const digest = await sha256Hex(token);
    const session = await this.ctx.storage.get<SessionRecord>(`sess:${digest}`);
    if (!session) return null;

    if (session.expiresAt <= Date.now()) {
      await this.ctx.storage.delete(`sess:${digest}`);
      return null;
    }

    const record = await this.ctx.storage.get<UserRecord>(`user:${session.userId}`);
    if (!record) return null;

    // Slide the expiry window so active players are not logged out mid-run.
    const refreshed = Date.now() + SESSION_TTL_MS;
    if (refreshed - session.expiresAt > 24 * 60 * 60 * 1000) {
      session.expiresAt = refreshed;
      await this.ctx.storage.put(`sess:${digest}`, session);
    }
    return record;
  }

  private async createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
    const { token, digest } = await mintSessionToken();
    const expiresAt = Date.now() + SESSION_TTL_MS;
    await this.ctx.storage.put(`sess:${digest}`, {
      userId,
      expiresAt,
      createdAt: Date.now(),
    } satisfies SessionRecord);
    return { token, expiresAt };
  }

  private async toProfile(record: UserRecord): Promise<UserProfileDto> {
    const friends: FriendDto[] = [];
    for (const edge of record.friends) {
      const friend = await this.ctx.storage.get<UserRecord>(`user:${edge.userId}`);
      if (!friend) continue;
      friends.push({
        userId: friend.userId,
        username: friend.username,
        totalPoints: friend.stats.totalPoints,
        wins: friend.stats.wins,
        addedAt: edge.addedAt,
      });
    }
    friends.sort((a, b) => b.totalPoints - a.totalPoints);

    return {
      kind: "USER",
      userId: record.userId,
      username: record.username,
      email: record.email,
      createdAt: record.createdAt,
      stats: record.stats,
      friends,
    };
  }

  private async syncLeaderboard(record: UserRecord): Promise<void> {
    await callDo(this.env, "Leaderboard", LEADERBOARD_ID, "/internal/upsert", {
      method: "POST",
      body: {
        subjectKind: "USER",
        subjectId: record.userId,
        displayName: record.username,
        stats: record.stats,
      },
    }).catch(() => undefined);
  }
}

// --------------------------------------------------------------------- utils

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
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
