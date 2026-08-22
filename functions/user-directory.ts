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
  mintPasswordResetToken,
  mintSessionToken,
  sha256Hex,
  validateEmail,
  validatePassword,
  validateUsername,
  verifyPassword,
  type FieldErrors,
} from "./auth-core";
import {
  GOOGLE_PLAY_REVIEW_EMAIL,
  GOOGLE_PLAY_REVIEW_ROLE,
  GOOGLE_PLAY_REVIEW_USERNAME,
  REVIEW_ACCOUNT_BALANCE,
  applyReviewAccountAccess,
  applyOutcome,
  applyRank,
  derivePresence,
  emptyStats,
  mergeStats,
  normalizeCurrencyBalances,
  normalizeEntitlements,
  normalizeStats,
  reviewAccountCurrencyBalances,
  reviewAccountEntitlements,
  SESSION_TTL_MS,
  type AuthResultDto,
  type FriendDto,
  type MatchOutcome,
  type PlayerStats,
  type PresenceRecord,
  type UserEntitlements,
  type UserProfileDto,
  type UserRole,
  type VirtualCurrencyBalances,
} from "./identity";
import { callDo, callDoJson, GUEST_REGISTRY_ID, LEADERBOARD_ID, type DoEnv } from "./do-dispatch";

type UserRecord = {
  userId: string;
  username: string;
  usernameLower: string;
  email: string;
  passwordHash: string;
  role?: UserRole;
  entitlements?: UserEntitlements;
  currencyBalances?: VirtualCurrencyBalances;
  createdAt: number;
  lastLoginAt: number;
  stats: PlayerStats;
  friends: { userId: string; addedAt: number }[];
  passwordResetDigest?: string;
  passwordResetExpiresAt?: number;
};

type SessionRecord = {
  userId: string;
  expiresAt: number;
  createdAt: number;
};

type PasswordResetRecord = {
  userId: string;
  expiresAt: number;
  createdAt: number;
};

const MAX_FRIENDS = 200;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;

/** Presence lives under its own key so a check-in never rewrites the account. */
function presenceKey(userId: string): string {
  return `pres:${userId}`;
}

export class UserDirectory extends DurableObject<DoEnv> {
  private reviewAccountSeeded = false;

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (!this.reviewAccountSeeded) await this.ensureGooglePlayReviewAccount();

      switch (`${request.method} ${path}`) {
        case "POST /auth/register":
          return await this.register(request);
        case "POST /auth/login":
          return await this.login(request);
        case "POST /auth/logout":
          return await this.logout(request);
        case "POST /auth/forgot-password":
          return await this.forgotPassword(request);
        case "POST /auth/reset-password":
          return await this.resetPassword(request);
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
        case "GET /friends":
          return await this.listFriends(request);
        case "POST /presence/ping":
          return await this.presencePing(request);
        case "POST /internal/presence":
          return await this.internalPresence(request);
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
    const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : null;
    if (guestId && body.transferStats === true) {
      const claimed = await callDoJson<{ ok: boolean; stats: PlayerStats | null }>(
        this.env,
        "GuestRegistry",
        GUEST_REGISTRY_ID,
        "/internal/guest/claim",
        { method: "POST", body: { guestId, guestSecret } },
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

    if (this.isReviewAccountIdentifier(identifier)) {
      await this.ensureGooglePlayReviewAccount({ forcePasswordRefresh: true });
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

  // ------------------------------------------------------------ reset password

  private async forgotPassword(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";

    if (!identifier) {
      return json({ error: "validation_failed", fields: { identifier: "Enter your username or email." } }, 400);
    }

    const key = identifier.includes("@")
      ? `email:${identifier.toLowerCase()}`
      : `uname:${identifier.toLowerCase()}`;
    const userId = await this.ctx.storage.get<string>(key);
    const record = userId ? await this.ctx.storage.get<UserRecord>(`user:${userId}`) : null;

    // Enumeration-resistant: unknown accounts get the same success body.
    if (!record) return json({ ok: true });

    if (record.passwordResetDigest) {
      await this.ctx.storage.delete(`reset:${record.passwordResetDigest}`);
    }

    const { token, digest } = await mintPasswordResetToken();
    const now = Date.now();
    record.passwordResetDigest = digest;
    record.passwordResetExpiresAt = now + PASSWORD_RESET_TTL_MS;

    await this.ctx.storage.put({
      [`user:${record.userId}`]: record,
      [`reset:${digest}`]: {
        userId: record.userId,
        expiresAt: record.passwordResetExpiresAt,
        createdAt: now,
      } satisfies PasswordResetRecord,
    });

    await this.sendPasswordResetEmail(record, token).catch((error) => {
      console.error("Password reset email failed", record.userId, (error as Error)?.message);
    });

    return json({ ok: true });
  }

  private async resetPassword(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const token = typeof body.token === "string" ? body.token.trim() : "";
    const digest = token ? await sha256Hex(token) : "";
    const ticket = digest ? await this.ctx.storage.get<PasswordResetRecord>(`reset:${digest}`) : null;

    if (!ticket || ticket.expiresAt <= Date.now()) {
      if (digest) await this.ctx.storage.delete(`reset:${digest}`);
      return json({ error: "validation_failed", fields: { token: "That reset code is invalid or expired." } }, 400);
    }

    const record = await this.ctx.storage.get<UserRecord>(`user:${ticket.userId}`);
    if (!record || record.passwordResetDigest !== digest) {
      await this.ctx.storage.delete(`reset:${digest}`);
      return json({ error: "validation_failed", fields: { token: "That reset code is invalid or expired." } }, 400);
    }

    const password = validatePassword(body.password, record.username);
    if (password.error) {
      return json({ error: "validation_failed", fields: { password: password.error } }, 400);
    }

    record.passwordHash = await hashPassword(password.value);
    delete record.passwordResetDigest;
    delete record.passwordResetExpiresAt;

    await this.revokeUserSessions(record.userId);
    await this.ctx.storage.put(`user:${record.userId}`, record);
    await this.ctx.storage.delete(`reset:${digest}`);

    const session = await this.createSession(record.userId);
    return json({
      token: session.token,
      expiresAt: session.expiresAt,
      profile: await this.toProfile(record),
      transferredFromGuest: false,
    } satisfies AuthResultDto);
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
      role: this.roleFor(record),
      entitlements: normalizeEntitlements(record.entitlements),
      currencyBalances: this.currencyBalancesFor(record),
      powerUpCharges: normalizeEntitlements(record.entitlements).unlimitedCurrency
        ? REVIEW_ACCOUNT_BALANCE
        : record.stats.powerUpCharges,
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

  /**
   * Friends plus live presence, without the rest of the profile. The friends
   * list polls this while it is on screen, so it is deliberately cheap.
   */
  private async listFriends(request: Request): Promise<Response> {
    const me = await this.authenticate(request);
    if (!me) return json({ error: "unauthorized" }, 401);

    // Reading your friends list is itself a sign of life.
    await this.touchPresence(me.userId, null);
    return json({ friends: await this.hydrateFriends(me) });
  }

  // ----------------------------------------------------------------- presence

  /** Client check-in. Called on a timer while the app is in the foreground. */
  private async presencePing(request: Request): Promise<Response> {
    const me = await this.authenticate(request);
    if (!me) return json({ error: "unauthorized" }, 401);

    const body = await safeJson(request);
    const inMatch = body.status === "IN_MATCH";
    const mode = typeof body.matchMode === "string" ? body.matchMode.slice(0, 16) : null;

    await this.touchPresence(me.userId, inMatch ? { matchMode: mode } : null);
    return json({ ok: true, friends: await this.hydrateFriends(me) });
  }

  /**
   * Presence written by a match room rather than the client. This is the
   * authoritative path for IN_MATCH: the room knows who is actually playing, so
   * a client cannot fake being in a match it never joined.
   */
  private async internalPresence(request: Request): Promise<Response> {
    const body = await safeJson(request);
    const userId = typeof body.userId === "string" ? body.userId : "";
    if (!userId) return json({ error: "bad_request" }, 400);
    if (!(await this.ctx.storage.get<UserRecord>(`user:${userId}`))) {
      return json({ ok: false, reason: "unknown_user" });
    }

    const inMatch = body.status === "IN_MATCH";
    const mode = typeof body.matchMode === "string" ? body.matchMode.slice(0, 16) : null;
    await this.touchPresence(userId, inMatch ? { matchMode: mode } : null);
    return json({ ok: true });
  }

  /**
   * Records a sign of life. Passing null means "active but not in a match";
   * passing a match descriptor sets the IN_MATCH claim.
   */
  private async touchPresence(
    userId: string,
    match: { matchMode: string | null } | null,
  ): Promise<void> {
    const now = Date.now();
    const previous = await this.ctx.storage.get<PresenceRecord>(presenceKey(userId));

    // Only move statusAt when the status actually changes, so the IN_MATCH
    // window measures how long the claim has stood rather than being pushed
    // forward by every unrelated ping.
    const status = match ? ("IN_MATCH" as const) : ("IDLE" as const);
    const changed = previous?.status !== status || previous?.matchMode !== (match?.matchMode ?? null);

    await this.ctx.storage.put(presenceKey(userId), {
      lastSeenAt: now,
      status,
      matchMode: match?.matchMode ?? null,
      statusAt: changed ? now : (previous?.statusAt ?? now),
    } satisfies PresenceRecord);
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

    const reportKey = `report:${outcome.matchId}:${outcome.subjectKind}:${outcome.subjectId}`;
    if (await this.ctx.storage.get(reportKey)) {
      return json({ ok: true, duplicate: true, stats: null });
    }

    const record = await this.ctx.storage.get<UserRecord>(`user:${outcome.subjectId}`);
    if (!record) return json({ error: "not_found" }, 404);

    record.stats = this.hasUnlimitedCurrency(record)
      ? applyReviewAccountAccess(applyOutcome(record.stats, outcome))
      : applyOutcome(record.stats, outcome);

    // Sync first so the rank we read back reflects the points just earned, then
    // fold that rank in as a possible new personal best.
    const worldRank = await this.syncLeaderboard(record);
    record.stats = applyRank(record.stats, worldRank);
    await this.ctx.storage.put({
      [`user:${record.userId}`]: record,
      [reportKey]: Date.now(),
    });

    return json({ ok: true, duplicate: false, stats: record.stats });
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

  private async ensureGooglePlayReviewAccount(options: { forcePasswordRefresh?: boolean } = {}): Promise<void> {
    if (this.reviewAccountSeeded && !options.forcePasswordRefresh) return;

    const email = (this.env.GOOGLE_PLAY_REVIEW_EMAIL ?? GOOGLE_PLAY_REVIEW_EMAIL).trim().toLowerCase();
    const username = (this.env.GOOGLE_PLAY_REVIEW_USERNAME ?? GOOGLE_PLAY_REVIEW_USERNAME).trim();
    const passwordHash = await hashPassword(this.env.GOOGLE_PLAY_REVIEW_PASSWORD ?? "Test?Test.");
    const entitlements = reviewAccountEntitlements();
    const currencyBalances = reviewAccountCurrencyBalances();
    const now = Date.now();

    await this.ctx.blockConcurrencyWhile(async () => {
      const existingUserId = await this.ctx.storage.get<string>(`email:${email}`);
      const existing = existingUserId
        ? await this.ctx.storage.get<UserRecord>(`user:${existingUserId}`)
        : null;

      if (existing) {
        existing.role = GOOGLE_PLAY_REVIEW_ROLE;
        existing.entitlements = entitlements;
        existing.currencyBalances = currencyBalances;
        existing.passwordHash = passwordHash;
        existing.stats = applyReviewAccountAccess(existing.stats);
        existing.lastLoginAt = Math.max(existing.lastLoginAt, now);
        await this.ctx.storage.put(`user:${existing.userId}`, existing);
        await this.syncLeaderboard(existing);
        return;
      }

      const selected = await this.availableReviewUsername(username);
      const userId = `u-${crypto.randomUUID()}`;
      const record: UserRecord = {
        userId,
        username: selected.username,
        usernameLower: selected.usernameLower,
        email,
        passwordHash,
        role: GOOGLE_PLAY_REVIEW_ROLE,
        entitlements,
        currencyBalances,
        createdAt: now,
        lastLoginAt: now,
        stats: applyReviewAccountAccess(emptyStats()),
        friends: [],
      };

      await this.ctx.storage.put({
        [`user:${userId}`]: record,
        [`uname:${selected.usernameLower}`]: userId,
        [`email:${email}`]: userId,
      });
      await this.syncLeaderboard(record);
    });

    this.reviewAccountSeeded = true;
  }

  private async revokeUserSessions(userId: string): Promise<void> {
    const sessions = await this.ctx.storage.list<SessionRecord>({ prefix: "sess:", limit: 1_000 });
    const deletes: string[] = [];
    for (const [key, session] of sessions) {
      if (session.userId === userId) deletes.push(key);
    }
    if (deletes.length > 0) await this.ctx.storage.delete(deletes);
  }

  private async sendPasswordResetEmail(record: UserRecord, token: string): Promise<void> {
    const link = resetLink(this.env.PASSWORD_RESET_BASE_URL, token);
    const text = [
      `Hi ${record.username},`,
      "",
      "Use this one-time reset code to create a new Quiz Royale password:",
      token,
      "",
      `Reset link: ${link}`,
      "",
      "This code expires in 30 minutes. If you did not request it, you can ignore this email.",
    ].join("\n");

    const endpoint = this.env.PASSWORD_RESET_EMAIL_ENDPOINT;
    if (!endpoint) {
      console.info("Password reset email not configured; reset token suppressed", record.userId);
      return;
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.env.PASSWORD_RESET_EMAIL_TOKEN) {
      headers.Authorization = `Bearer ${this.env.PASSWORD_RESET_EMAIL_TOKEN}`;
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: record.email,
        from: this.env.PASSWORD_RESET_FROM ?? "no-reply@quizroyale.example",
        subject: "Reset your Quiz Royale password",
        text,
        html:
          `<p>Hi ${escapeHtml(record.username)},</p>` +
          "<p>Use this one-time reset code to create a new Quiz Royale password:</p>" +
          `<p><strong>${escapeHtml(token)}</strong></p>` +
          `<p><a href="${escapeHtml(link)}">Reset your password</a></p>` +
          "<p>This code expires in 30 minutes. If you did not request it, you can ignore this email.</p>",
      }),
    });

    if (!response.ok) {
      throw new Error(`email provider returned ${response.status}`);
    }
  }

  /** Resolves friend edges into rows carrying stats and live presence. */
  private async hydrateFriends(record: UserRecord): Promise<FriendDto[]> {
    const now = Date.now();
    const friends: FriendDto[] = [];

    for (const edge of record.friends) {
      const friend = await this.ctx.storage.get<UserRecord>(`user:${edge.userId}`);
      if (!friend) continue;

      const presence = derivePresence(
        await this.ctx.storage.get<PresenceRecord>(presenceKey(friend.userId)),
        now,
      );

      friends.push({
        userId: friend.userId,
        username: friend.username,
        totalPoints: friend.stats.totalPoints,
        wins: friend.stats.wins,
        addedAt: edge.addedAt,
        presence: presence.presence,
        matchMode: presence.matchMode,
        lastSeenAt: presence.lastSeenAt,
      });
    }

    // Active friends first — that is what the list is for — then by points.
    const weight: Record<string, number> = { IN_MATCH: 0, ONLINE: 1, OFFLINE: 2 };
    friends.sort((a, b) => {
      const rank = (weight[a.presence] ?? 2) - (weight[b.presence] ?? 2);
      if (rank !== 0) return rank;
      return b.totalPoints - a.totalPoints;
    });
    return friends;
  }

  private async toProfile(record: UserRecord): Promise<UserProfileDto> {
    const entitlements = normalizeEntitlements(record.entitlements);
    return {
      kind: "USER",
      userId: record.userId,
      username: record.username,
      email: record.email,
      role: this.roleFor(record),
      entitlements,
      currencyBalances: this.currencyBalancesFor(record),
      createdAt: record.createdAt,
      stats: entitlements.unlimitedCurrency
        ? applyReviewAccountAccess(record.stats)
        : normalizeStats(record.stats),
      friends: await this.hydrateFriends(record),
    };
  }

  private isReviewAccountIdentifier(identifier: string): boolean {
    const normalized = identifier.trim().toLowerCase();
    return normalized === (this.env.GOOGLE_PLAY_REVIEW_EMAIL ?? GOOGLE_PLAY_REVIEW_EMAIL).toLowerCase()
      || normalized === (this.env.GOOGLE_PLAY_REVIEW_USERNAME ?? GOOGLE_PLAY_REVIEW_USERNAME).toLowerCase();
  }

  private roleFor(record: UserRecord): UserRole {
    return record.role === GOOGLE_PLAY_REVIEW_ROLE ? GOOGLE_PLAY_REVIEW_ROLE : "player";
  }

  private hasUnlimitedCurrency(record: UserRecord): boolean {
    return normalizeEntitlements(record.entitlements).unlimitedCurrency;
  }

  private currencyBalancesFor(record: UserRecord): VirtualCurrencyBalances {
    return this.hasUnlimitedCurrency(record)
      ? reviewAccountCurrencyBalances()
      : normalizeCurrencyBalances(record.currencyBalances);
  }

  private async availableReviewUsername(preferredUsername: string): Promise<{ username: string; usernameLower: string }> {
    for (const username of [preferredUsername, "play_reviewer"]) {
      const usernameLower = username.toLowerCase();
      if (!(await this.ctx.storage.get<string>(`uname:${usernameLower}`))) return { username, usernameLower };
    }
    const username = `review_${crypto.randomUUID().slice(0, 8)}`;
    return { username, usernameLower: username.toLowerCase() };
  }

  /** Upserts the board row and returns the world rank it produced, if any. */
  private async syncLeaderboard(record: UserRecord): Promise<number | null> {
    const result = await callDoJson<{ worldRank: number | null }>(
      this.env,
      "Leaderboard",
      LEADERBOARD_ID,
      "/internal/upsert",
      {
        method: "POST",
        body: {
          subjectKind: "USER",
          subjectId: record.userId,
          displayName: record.username,
          stats: record.stats,
        },
      },
    ).catch(() => null);
    return result?.worldRank ?? null;
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

function resetLink(base: string | undefined, token: string): string {
  const root = (base?.trim() || "quizroyale://reset-password").replace(/[?&]token=$/, "");
  const separator = root.includes("?") ? "&" : "?";
  return `${root}${separator}token=${encodeURIComponent(token)}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
