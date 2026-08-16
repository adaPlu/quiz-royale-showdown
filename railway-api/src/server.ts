import http from "node:http";
import { URL } from "node:url";
import { z } from "zod";
import { pool, tx, type DbClient } from "./db.js";
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
} from "./auth-core.js";
import { CATEGORIES, WORLD_BOARD, normalizeBoard } from "./categories.js";
import { closeCache } from "./cache.js";
import {
  GUEST_TTL_MS,
  SESSION_TTL_MS,
  applyOutcome,
  applyRank,
  derivePresence,
  emptyStats,
  mergeStats,
  normalizeStats,
  type AuthResultDto,
  type FriendDto,
  type GuestSessionDto,
  type LeaderboardDto,
  type MatchOutcome,
  type PlayerStats,
  type PresenceRecord,
  type SubjectKind,
  type UserProfileDto,
} from "./identity.js";
import {
  cachedLeaderboard,
  generateQuestions,
  generateQuestionsSchema,
  invalidateLeaderboardCaches,
  recordUsage,
  selectQuestionsSchema,
  selectQuestionSet,
  usageReportSchema,
} from "./question-service.js";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const MAX_FRIENDS = 200;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": process.env.CORS_ORIGIN ?? "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Internal-Token",
};

type UserRow = {
  user_id: string;
  username: string;
  username_lower: string;
  email: string;
  password_hash: string;
  created_at: string | number;
  last_login_at: string | number;
};

type GuestRow = {
  guest_id: string;
  slot: number;
  display_name: string;
  created_at: string | number;
  last_seen_at: string | number;
  expires_at: string | number;
};

const matchOutcomeSchema = z.object({
  matchId: z.string().min(1),
  subjectKind: z.enum(["USER", "GUEST"]),
  subjectId: z.string().min(1),
  displayName: z.string().min(1),
  won: z.boolean(),
  placement: z.number().int().positive().nullable(),
  score: z.number().int(),
  correctAnswers: z.number().int().nonnegative(),
  powerUpsUsed: z.number().int().nonnegative(),
  categoryPoints: z.record(z.number().int()),
  recordWinLoss: z.boolean(),
});

const server = http.createServer(async (request, response) => {
  try {
    if (request.method === "OPTIONS") return send(response, 204, null);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return send(response, 200, { ok: true, service: "quiz-royale-api", now: Date.now() });
    }

    if (request.method === "POST" && url.pathname === "/auth/register") return sendResponse(response, await register(request));
    if (request.method === "POST" && url.pathname === "/auth/login") return sendResponse(response, await login(request));
    if (request.method === "POST" && url.pathname === "/auth/logout") return sendResponse(response, await logout(request));
    if (request.method === "POST" && url.pathname === "/auth/forgot-password") return sendResponse(response, await forgotPassword(request));
    if (request.method === "POST" && url.pathname === "/auth/reset-password") return sendResponse(response, await resetPassword(request));
    if (request.method === "GET" && url.pathname === "/auth/me") return sendResponse(response, await me(request));
    if (request.method === "GET" && url.pathname === "/auth/resolve") return sendResponse(response, await resolveUser(request));

    if (request.method === "POST" && url.pathname === "/guest/session") return sendResponse(response, await guestSession(request));
    if (request.method === "POST" && url.pathname === "/guest/heartbeat") return sendResponse(response, await guestHeartbeat(request));
    if (request.method === "POST" && url.pathname === "/guest/end") return sendResponse(response, await guestEnd(request));
    if (request.method === "GET" && url.pathname === "/guest/me") return sendResponse(response, await guestMe(url));
    if (request.method === "GET" && url.pathname === "/internal/guest/resolve") return sendResponse(response, await resolveGuest(request, url));
    if (request.method === "POST" && url.pathname === "/internal/guest/claim") return sendResponse(response, await claimGuest(request));

    if (request.method === "GET" && url.pathname === "/friends") return sendResponse(response, await listFriends(request));
    if (request.method === "POST" && url.pathname === "/friends/add") return sendResponse(response, await addFriend(request));
    if (request.method === "POST" && url.pathname === "/friends/remove") return sendResponse(response, await removeFriend(request));
    if (request.method === "GET" && url.pathname === "/users/search") return sendResponse(response, await searchUsers(url));
    if (request.method === "POST" && url.pathname === "/presence/ping") return sendResponse(response, await presencePing(request));
    if (request.method === "POST" && url.pathname === "/internal/presence") return sendResponse(response, await internalPresence(request));
    if (request.method === "GET" && url.pathname === "/powerups") return sendResponse(response, await powerups(request, url));

    if (request.method === "GET" && url.pathname === "/leaderboard/boards") return send(response, 200, { boards: [WORLD_BOARD, ...CATEGORIES] });
    if (request.method === "GET" && url.pathname === "/leaderboard") {
      return sendResponse(response, await cachedLeaderboard(url.search || "default", () => leaderboard(url)));
    }
    if (request.method === "POST" && url.pathname === "/internal/report") return sendResponse(response, await internalReport(request));
    if (request.method === "POST" && url.pathname === "/internal/questions/select") return sendResponse(response, await internalQuestionSelect(request));
    if (request.method === "POST" && url.pathname === "/internal/questions/usage") return sendResponse(response, await internalQuestionUsage(request));
    if (request.method === "POST" && url.pathname === "/internal/questions/generate") return sendResponse(response, await internalQuestionGenerate(request));

    return send(response, 404, { error: "not_found" });
  } catch (error) {
    console.error("request failed", request.method, request.url, (error as Error)?.message);
    return send(response, 500, { error: "internal_error", message: "Something went wrong." });
  }
});

server.listen(PORT, () => {
  console.log(`quiz-royale-api listening on ${PORT}`);
});

async function register(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const username = validateUsername(body.username);
  const email = validateEmail(body.email);
  const password = validatePassword(body.password, username.value);

  const errors: FieldErrors = {};
  if (username.error) errors.username = username.error;
  if (email.error) errors.email = email.error;
  if (password.error) errors.password = password.error;
  if (Object.keys(errors).length > 0) return [400, { error: "validation_failed", fields: errors }];

  const passwordHash = await hashPassword(password.value);
  const now = Date.now();
  const userId = `u-${crypto.randomUUID()}`;
  const guestId = typeof body.guestId === "string" ? body.guestId : null;
  const transferStats = guestId !== null && body.transferStats === true;

  try {
    const result = await tx(async (client) => {
      await client.query(
        `INSERT INTO users(user_id, username, username_lower, email, password_hash, created_at, last_login_at)
         VALUES ($1, $2, $3, $4, $5, $6, $6)`,
        [userId, username.value, username.value.toLowerCase(), email.value, passwordHash, now],
      );

      let stats = emptyStats();
      let transferred = false;
      if (transferStats) {
        const claimed = await claimGuestInTx(client, guestId);
        if (claimed) {
          stats = mergeStats(stats, claimed);
          transferred = true;
        }
      }

      await putStats(client, "USER", userId, username.value, stats, null);
      await syncLeaderboard(client, "USER", userId, username.value, stats, null);
      const ranked = await worldRank(client, "USER", userId);
      stats = applyRank(stats, ranked);
      await putStats(client, "USER", userId, username.value, stats, null);
      await syncLeaderboard(client, "USER", userId, username.value, stats, null);

      const session = await createSession(client, userId);
      const profile = await toProfile(client, { user_id: userId, username: username.value, username_lower: username.value.toLowerCase(), email: email.value, password_hash: passwordHash, created_at: now, last_login_at: now });
      return { session, profile, transferred };
    });

    return [201, {
      token: result.session.token,
      expiresAt: result.session.expiresAt,
      profile: result.profile,
      transferredFromGuest: result.transferred,
    } satisfies AuthResultDto];
  } catch (error) {
    if (isUnique(error, "users_username_lower_key")) {
      return [409, { error: "validation_failed", fields: { username: "That username is taken." } }];
    }
    if (isUnique(error, "users_email_key")) {
      return [409, { error: "validation_failed", fields: { email: "That email is already registered." } }];
    }
    throw error;
  }
}

async function login(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!identifier || !password) {
    return [400, { error: "validation_failed", fields: { identifier: "Enter your login details." } }];
  }

  const record = await findUserByIdentifier(pool, identifier);
  if (!record) return [401, { error: "invalid_credentials", message: "Incorrect login details." }];

  const verification = await verifyPassword(password, record.password_hash);
  if (!verification.valid) return [401, { error: "invalid_credentials", message: "Incorrect login details." }];

  const result = await tx(async (client) => {
    const now = Date.now();
    if (verification.needsRehash) {
      record.password_hash = await hashPassword(password);
    }
    await client.query(
      "UPDATE users SET password_hash = $2, last_login_at = $3 WHERE user_id = $1",
      [record.user_id, record.password_hash, now],
    );
    const session = await createSession(client, record.user_id);
    const profile = await toProfile(client, record);
    return { session, profile };
  });

  return [200, {
    token: result.session.token,
    expiresAt: result.session.expiresAt,
    profile: result.profile,
    transferredFromGuest: false,
  } satisfies AuthResultDto];
}

async function logout(request: http.IncomingMessage): Promise<ApiResponse> {
  const token = bearer(request);
  if (token) await pool.query("DELETE FROM sessions WHERE token_digest = $1", [sha256Hex(token)]);
  return [200, { ok: true }];
}

async function forgotPassword(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const identifier = typeof body.identifier === "string" ? body.identifier.trim() : "";
  if (!identifier) {
    return [400, { error: "validation_failed", fields: { identifier: "Enter your username or email." } }];
  }

  const record = await findUserByIdentifier(pool, identifier);
  if (!record) return [200, { ok: true }];

  const { token, digest } = await mintPasswordResetToken();
  const expiresAt = Date.now() + PASSWORD_RESET_TTL_MS;
  await tx(async (client) => {
    await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [record.user_id]);
    await client.query(
      "INSERT INTO password_reset_tokens(token_digest, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
      [digest, record.user_id, expiresAt, Date.now()],
    );
  });
  await sendPasswordResetEmail(record, token).catch((error) => {
    console.error("password reset email failed", record.user_id, (error as Error)?.message);
  });
  return [200, { ok: true }];
}

async function resetPassword(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = validatePassword(body.password);
  if (!token) return [400, { error: "validation_failed", fields: { token: "That reset code is invalid or expired." } }];
  if (password.error) return [400, { error: "validation_failed", fields: { password: password.error } }];

  const digest = sha256Hex(token);
  const result = await tx(async (client) => {
    const ticket = await client.query<{ user_id: string; expires_at: string | number }>(
      "SELECT user_id, expires_at FROM password_reset_tokens WHERE token_digest = $1 FOR UPDATE",
      [digest],
    );
    const row = ticket.rows[0];
    if (!row || Number(row.expires_at) <= Date.now()) {
      await client.query("DELETE FROM password_reset_tokens WHERE token_digest = $1", [digest]);
      return null;
    }
    const record = await getUser(client, row.user_id);
    if (!record) return null;

    await client.query("UPDATE users SET password_hash = $2 WHERE user_id = $1", [record.user_id, await hashPassword(password.value)]);
    await client.query("DELETE FROM sessions WHERE user_id = $1", [record.user_id]);
    await client.query("DELETE FROM password_reset_tokens WHERE user_id = $1", [record.user_id]);
    const session = await createSession(client, record.user_id);
    return { session, profile: await toProfile(client, record) };
  });

  if (!result) return [400, { error: "validation_failed", fields: { token: "That reset code is invalid or expired." } }];
  return [200, {
    token: result.session.token,
    expiresAt: result.session.expiresAt,
    profile: result.profile,
    transferredFromGuest: false,
  } satisfies AuthResultDto];
}

async function me(request: http.IncomingMessage): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  return [200, { profile: await toProfile(pool, record) }];
}

async function resolveUser(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  const stats = await getStats(pool, "USER", record.user_id);
  return [200, { userId: record.user_id, username: record.username, powerUpCharges: stats.powerUpCharges }];
}

async function guestSession(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const displayName = sanitizeGuestName(body.displayName);
  const existingId = typeof body.guestId === "string" ? body.guestId : null;

  const result = await tx(async (client) => {
    if (existingId) {
      const existing = await getGuest(client, existingId, true);
      if (existing && Number(existing.expires_at) > Date.now()) {
        const now = Date.now();
        const expiresAt = now + GUEST_TTL_MS;
        const name = displayName || existing.display_name;
        await client.query(
          "UPDATE guests SET display_name = $2, last_seen_at = $3, expires_at = $4 WHERE guest_id = $1",
          [existing.guest_id, name, now, expiresAt],
        );
        const stats = await getStats(client, "GUEST", existing.guest_id);
        await putStats(client, "GUEST", existing.guest_id, name, stats, expiresAt);
        await syncLeaderboard(client, "GUEST", existing.guest_id, name, stats, expiresAt);
        return { session: toGuestDto({ ...existing, display_name: name, last_seen_at: now, expires_at: expiresAt }, stats), reused: true };
      }
    }

    const slot = await takeGuestSlot(client);
    const now = Date.now();
    const guestId = `g${slot}-${crypto.randomUUID().replace(/-/g, "").slice(0, 6)}`;
    const name = displayName || `Guest${slot}`;
    const expiresAt = now + GUEST_TTL_MS;
    const stats = emptyStats();
    await client.query(
      "INSERT INTO guests(guest_id, slot, display_name, created_at, last_seen_at, expires_at) VALUES ($1, $2, $3, $4, $4, $5)",
      [guestId, slot, name, now, expiresAt],
    );
    await putStats(client, "GUEST", guestId, name, stats, expiresAt);
    return { session: toGuestDto({ guest_id: guestId, slot, display_name: name, created_at: now, last_seen_at: now, expires_at: expiresAt }, stats), reused: false };
  });
  return [result.reused ? 200 : 201, { guest: result.session, reused: result.reused }];
}

async function guestHeartbeat(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const guestId = typeof body.guestId === "string" ? body.guestId : "";
  const result = await tx(async (client) => {
    const guest = await getGuest(client, guestId, true);
    if (!guest || Number(guest.expires_at) <= Date.now()) return null;
    const now = Date.now();
    const expiresAt = now + GUEST_TTL_MS;
    await client.query("UPDATE guests SET last_seen_at = $2, expires_at = $3 WHERE guest_id = $1", [guestId, now, expiresAt]);
    const stats = await getStats(client, "GUEST", guestId);
    await putStats(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    await syncLeaderboard(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    return toGuestDto({ ...guest, last_seen_at: now, expires_at: expiresAt }, stats);
  });
  if (!result) return [404, { error: "guest_expired", message: "This guest session has expired." }];
  return [200, { guest: result }];
}

async function guestEnd(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const guestId = typeof body.guestId === "string" ? body.guestId : "";
  const retired = await tx(async (client) => retireGuest(client, guestId));
  return [200, { ok: true, retired }];
}

async function guestMe(url: URL): Promise<ApiResponse> {
  const guestId = url.searchParams.get("guestId") ?? "";
  const guest = await getGuest(pool, guestId);
  if (!guest || Number(guest.expires_at) <= Date.now()) return [404, { error: "guest_expired" }];
  return [200, { guest: toGuestDto(guest, await getStats(pool, "GUEST", guestId)) }];
}

async function resolveGuest(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const guestId = url.searchParams.get("guestId") ?? "";
  const result = await tx(async (client) => {
    const guest = await getGuest(client, guestId, true);
    if (!guest || Number(guest.expires_at) <= Date.now()) return null;
    const now = Date.now();
    const expiresAt = now + GUEST_TTL_MS;
    await client.query("UPDATE guests SET last_seen_at = $2, expires_at = $3 WHERE guest_id = $1", [guestId, now, expiresAt]);
    const stats = await getStats(client, "GUEST", guestId);
    await putStats(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    await syncLeaderboard(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    return { guestId, displayName: guest.display_name, powerUpCharges: stats.powerUpCharges };
  });
  if (!result) return [404, { error: "guest_expired" }];
  return [200, result];
}

async function claimGuest(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const guestId = typeof body.guestId === "string" ? body.guestId : "";
  const stats = await tx(async (client) => claimGuestInTx(client, guestId));
  return [200, { ok: Boolean(stats), stats }];
}

async function listFriends(request: http.IncomingMessage): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  await touchPresence(pool, record.user_id, null);
  return [200, { friends: await hydrateFriends(pool, record.user_id) }];
}

async function addFriend(request: http.IncomingMessage): Promise<ApiResponse> {
  const meRow = await authenticate(request);
  if (!meRow) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) return [400, { error: "validation_failed", message: "Enter a username." }];

  const profile = await tx(async (client) => {
    const target = await findUserByIdentifier(client, username);
    if (!target) return { status: 404 as const, body: { error: "not_found", message: "No player with that username." } };
    if (target.user_id === meRow.user_id) return { status: 400 as const, body: { error: "invalid", message: "You cannot add yourself." } };
    const count = await client.query<{ count: string }>("SELECT count(*) FROM friendships WHERE user_id = $1", [meRow.user_id]);
    if (Number(count.rows[0]?.count ?? 0) >= MAX_FRIENDS) {
      return { status: 409 as const, body: { error: "limit_reached", message: "Your friends list is full." } };
    }
    const existing = await client.query("SELECT 1 FROM friendships WHERE user_id = $1 AND friend_user_id = $2", [meRow.user_id, target.user_id]);
    if (existing.rowCount) return { status: 409 as const, body: { error: "already_friends", message: `${target.username} is already a friend.` } };
    const now = Date.now();
    await client.query(
      `INSERT INTO friendships(user_id, friend_user_id, added_at)
       VALUES ($1, $2, $3), ($2, $1, $3)
       ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
      [meRow.user_id, target.user_id, now],
    );
    return { status: 200 as const, body: { ok: true, profile: await toProfile(client, meRow) } };
  });
  return [profile.status, profile.body];
}

async function removeFriend(request: http.IncomingMessage): Promise<ApiResponse> {
  const meRow = await authenticate(request);
  if (!meRow) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const targetId = typeof body.userId === "string" ? body.userId : "";
  if (!targetId) return [400, { error: "validation_failed", message: "Missing friend id." }];
  const profile = await tx(async (client) => {
    await client.query(
      `DELETE FROM friendships
       WHERE (user_id = $1 AND friend_user_id = $2) OR (user_id = $2 AND friend_user_id = $1)`,
      [meRow.user_id, targetId],
    );
    return await toProfile(client, meRow);
  });
  return [200, { ok: true, profile }];
}

async function searchUsers(url: URL): Promise<ApiResponse> {
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (q.length < 2) return [200, { results: [] }];
  const rows = await pool.query<{ user_id: string; username: string }>(
    "SELECT user_id, username FROM users WHERE username_lower LIKE $1 ORDER BY username_lower LIMIT 20",
    [`%${q}%`],
  );
  return [200, { results: rows.rows.map((row) => ({ userId: row.user_id, username: row.username })) }];
}

async function presencePing(request: http.IncomingMessage): Promise<ApiResponse> {
  const meRow = await authenticate(request);
  if (!meRow) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const inMatch = body.status === "IN_MATCH";
  const matchMode = typeof body.matchMode === "string" ? body.matchMode.slice(0, 16) : null;
  await touchPresence(pool, meRow.user_id, inMatch ? { matchMode } : null);
  return [200, { ok: true, friends: await hydrateFriends(pool, meRow.user_id) }];
}

async function internalPresence(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return [400, { error: "bad_request" }];
  const user = await getUser(pool, userId);
  if (!user) return [200, { ok: false, reason: "unknown_user" }];
  const matchMode = typeof body.matchMode === "string" ? body.matchMode.slice(0, 16) : null;
  await touchPresence(pool, userId, body.status === "IN_MATCH" ? { matchMode } : null);
  return [200, { ok: true }];
}

async function powerups(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (record) {
    return [200, { inventory: await getPowerupInventory(pool, "USER", record.user_id) }];
  }

  const guestId = url.searchParams.get("guestId") ?? "";
  if (!guestId) return [401, { error: "unauthorized" }];
  const guest = await getGuest(pool, guestId);
  if (!guest || Number(guest.expires_at) <= Date.now()) return [404, { error: "guest_expired" }];
  return [200, { inventory: await getPowerupInventory(pool, "GUEST", guestId) }];
}

async function leaderboard(url: URL): Promise<ApiResponse> {
  await cleanupExpiredGuests(pool);
  const board = normalizeBoard(url.searchParams.get("board"));
  const limit = clamp(Number.parseInt(url.searchParams.get("limit") ?? "", 10) || 50, 1, 200);
  const viewerId = url.searchParams.get("subjectId");
  const orderExpr = board === WORLD_BOARD ? "total_points" : `(COALESCE((category_points ->> $1)::int, 0))`;
  const params: unknown[] = board === WORLD_BOARD ? [limit] : [board, limit];
  const limitIndex = board === WORLD_BOARD ? 1 : 2;
  const rows = await pool.query<{
    rank: string;
    subject_kind: SubjectKind;
    subject_id: string;
    display_name: string;
    points: string | number;
    wins: number;
  }>(
    `WITH ranked AS (
       SELECT subject_kind, subject_id, display_name, ${orderExpr} AS points, wins,
              rank() OVER (ORDER BY ${orderExpr} DESC, wins DESC, updated_at ASC) AS rank
       FROM leaderboard_entries
       WHERE (expires_at IS NULL OR expires_at > ${Date.now()})
     )
     SELECT * FROM ranked WHERE points > 0 ORDER BY rank ASC LIMIT $${limitIndex}`,
    params,
  );

  let yourRank: number | null = null;
  let yourPoints = 0;
  if (viewerId) {
    const selfParams: unknown[] = board === WORLD_BOARD ? [viewerId] : [board, viewerId];
    const viewerIndex = board === WORLD_BOARD ? 1 : 2;
    const self = await pool.query<{ rank: string; points: string | number }>(
      `WITH ranked AS (
         SELECT subject_id, ${orderExpr} AS points,
                rank() OVER (ORDER BY ${orderExpr} DESC, wins DESC, updated_at ASC) AS rank
         FROM leaderboard_entries
         WHERE (expires_at IS NULL OR expires_at > ${Date.now()})
       )
       SELECT rank, points FROM ranked WHERE subject_id = $${viewerIndex}`,
      selfParams,
    );
    if (self.rows[0]) {
      yourRank = Number(self.rows[0].rank);
      yourPoints = Number(self.rows[0].points);
    }
  }
  const totalParams: unknown[] = board === WORLD_BOARD ? [Date.now()] : [board, Date.now()];
  const nowIndex = board === WORLD_BOARD ? 1 : 2;
  const total = await pool.query<{ count: string }>(
    `SELECT count(*) FROM leaderboard_entries
     WHERE (expires_at IS NULL OR expires_at > $${nowIndex}) AND ${orderExpr} > 0`,
    totalParams,
  );
  return [200, {
    board,
    entries: rows.rows.map((row) => ({
      rank: Number(row.rank),
      subjectKind: row.subject_kind,
      subjectId: row.subject_id,
      displayName: row.display_name,
      points: Number(row.points),
      wins: row.wins,
      isYou: row.subject_id === viewerId,
    })),
    yourRank,
    yourPoints,
    totalRanked: Number(total.rows[0]?.count ?? 0),
  } satisfies LeaderboardDto];
}

async function internalReport(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const parsed = matchOutcomeSchema.safeParse(body.outcome);
  if (!parsed.success) return [400, { error: "bad_request" }];
  const outcome = parsed.data satisfies MatchOutcome;
  const result = await tx(async (client) => applyMatchOutcome(client, outcome));
  return result
    ? [200, { ok: true, duplicate: result.duplicate, stats: result.stats }]
    : [404, { error: outcome.subjectKind === "GUEST" ? "guest_expired" : "not_found" }];
}

async function internalQuestionSelect(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const parsed = selectQuestionsSchema.safeParse(await safeJson(request));
  if (!parsed.success) return [400, { error: "bad_request" }];
  try {
    const questions = await selectQuestionSet(pool, parsed.data.count);
    return [200, { questions }];
  } catch (error) {
    return [503, { error: "question_pool_unavailable", message: (error as Error).message }];
  }
}

async function internalQuestionUsage(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const parsed = usageReportSchema.safeParse(await safeJson(request));
  if (!parsed.success) return [400, { error: "bad_request" }];
  const result = await recordUsage(parsed.data);
  return [200, { ok: true, ...result }];
}

async function internalQuestionGenerate(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const parsed = generateQuestionsSchema.safeParse(await safeJson(request));
  if (!parsed.success) return [400, { error: "bad_request" }];
  const result = await generateQuestions(
    parsed.data.category,
    parsed.data.difficulty,
    parsed.data.count,
    parsed.data.reason,
  );
  return [result.status === "failed" ? 502 : 200, { ok: result.status !== "failed", ...result }];
}

async function applyMatchOutcome(client: DbClient, outcome: MatchOutcome): Promise<{ duplicate: boolean; stats: PlayerStats | null } | null> {
  const claim = await client.query(
    `INSERT INTO match_reports(match_id, subject_kind, subject_id, reported_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING
     RETURNING match_id`,
    [outcome.matchId, outcome.subjectKind, outcome.subjectId, Date.now()],
  );
  if (claim.rowCount === 0) return { duplicate: true, stats: null };

  if (outcome.subjectKind === "GUEST") {
    const guest = await getGuest(client, outcome.subjectId, true);
    if (!guest || Number(guest.expires_at) <= Date.now()) return null;
    const now = Date.now();
    const expiresAt = now + GUEST_TTL_MS;
    const stats = applyOutcome(await getStats(client, "GUEST", outcome.subjectId), outcome);
    await client.query("UPDATE guests SET last_seen_at = $2, expires_at = $3 WHERE guest_id = $1", [outcome.subjectId, now, expiresAt]);
    await putStats(client, "GUEST", outcome.subjectId, guest.display_name, stats, expiresAt);
    const rank = await syncLeaderboard(client, "GUEST", outcome.subjectId, guest.display_name, stats, expiresAt);
    const ranked = applyRank(stats, rank);
    await putStats(client, "GUEST", outcome.subjectId, guest.display_name, ranked, expiresAt);
    await syncLeaderboard(client, "GUEST", outcome.subjectId, guest.display_name, ranked, expiresAt);
    return { duplicate: false, stats: ranked };
  }

  const user = await getUser(client, outcome.subjectId);
  if (!user) return null;
  const stats = applyOutcome(await getStats(client, "USER", outcome.subjectId), outcome);
  await putStats(client, "USER", outcome.subjectId, user.username, stats, null);
  const rank = await syncLeaderboard(client, "USER", outcome.subjectId, user.username, stats, null);
  const ranked = applyRank(stats, rank);
  await putStats(client, "USER", outcome.subjectId, user.username, ranked, null);
  await syncLeaderboard(client, "USER", outcome.subjectId, user.username, ranked, null);
  return { duplicate: false, stats: ranked };
}

async function findUserByIdentifier(db: DbClient, identifier: string): Promise<UserRow | null> {
  const key = identifier.includes("@") ? "email" : "username_lower";
  const result = await db.query<UserRow>(`SELECT * FROM users WHERE ${key} = $1`, [identifier.toLowerCase()]);
  return result.rows[0] ?? null;
}

async function getUser(db: DbClient, userId: string): Promise<UserRow | null> {
  const result = await db.query<UserRow>("SELECT * FROM users WHERE user_id = $1", [userId]);
  return result.rows[0] ?? null;
}

async function authenticate(request: http.IncomingMessage): Promise<UserRow | null> {
  const token = bearer(request);
  if (!token) return null;
  const digest = sha256Hex(token);
  const result = await pool.query<{ user_id: string; expires_at: string | number }>(
    "SELECT user_id, expires_at FROM sessions WHERE token_digest = $1",
    [digest],
  );
  const session = result.rows[0];
  if (!session) return null;
  if (Number(session.expires_at) <= Date.now()) {
    await pool.query("DELETE FROM sessions WHERE token_digest = $1", [digest]);
    return null;
  }
  const record = await getUser(pool, session.user_id);
  if (!record) return null;
  const refreshed = Date.now() + SESSION_TTL_MS;
  if (refreshed - Number(session.expires_at) > 24 * 60 * 60 * 1000) {
    await pool.query("UPDATE sessions SET expires_at = $2 WHERE token_digest = $1", [digest, refreshed]);
  }
  return record;
}

async function createSession(client: DbClient, userId: string): Promise<{ token: string; expiresAt: number }> {
  const { token, digest } = await mintSessionToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  await client.query(
    "INSERT INTO sessions(token_digest, user_id, expires_at, created_at) VALUES ($1, $2, $3, $4)",
    [digest, userId, expiresAt, Date.now()],
  );
  return { token, expiresAt };
}

async function toProfile(db: DbClient, record: UserRow): Promise<UserProfileDto> {
  return {
    kind: "USER",
    userId: record.user_id,
    username: record.username,
    email: record.email,
    createdAt: Number(record.created_at),
    stats: await getStats(db, "USER", record.user_id),
    friends: await hydrateFriends(db, record.user_id),
  };
}

async function hydrateFriends(db: DbClient, userId: string): Promise<FriendDto[]> {
  const rows = await db.query<{
    user_id: string;
    username: string;
    added_at: string | number;
    stats: PlayerStats | null;
    last_seen_at: string | number | null;
    status: "IDLE" | "IN_MATCH" | null;
    match_mode: string | null;
    status_at: string | number | null;
  }>(
    `SELECT u.user_id, u.username, f.added_at, ps.stats, p.last_seen_at, p.status, p.match_mode, p.status_at
     FROM friendships f
     JOIN users u ON u.user_id = f.friend_user_id
     LEFT JOIN player_stats ps ON ps.subject_kind = 'USER' AND ps.subject_id = u.user_id
     LEFT JOIN presence p ON p.user_id = u.user_id
     WHERE f.user_id = $1`,
    [userId],
  );
  const friends = rows.rows.map((row) => {
    const stats = normalizeStats(row.stats);
    const presence = derivePresence(row.status ? {
      lastSeenAt: Number(row.last_seen_at ?? 0),
      status: row.status,
      matchMode: row.match_mode,
      statusAt: Number(row.status_at ?? 0),
    } satisfies PresenceRecord : null);
    return {
      userId: row.user_id,
      username: row.username,
      totalPoints: stats.totalPoints,
      wins: stats.wins,
      addedAt: Number(row.added_at),
      presence: presence.presence,
      matchMode: presence.matchMode,
      lastSeenAt: presence.lastSeenAt,
    };
  });
  const weight: Record<string, number> = { IN_MATCH: 0, ONLINE: 1, OFFLINE: 2 };
  return friends.sort((a, b) => (weight[a.presence] ?? 2) - (weight[b.presence] ?? 2) || b.totalPoints - a.totalPoints);
}

async function getStats(db: DbClient, subjectKind: SubjectKind, subjectId: string): Promise<PlayerStats> {
  const result = await db.query<{ stats: PlayerStats }>(
    "SELECT stats FROM player_stats WHERE subject_kind = $1 AND subject_id = $2",
    [subjectKind, subjectId],
  );
  return normalizeStats(result.rows[0]?.stats);
}

async function putStats(
  db: DbClient,
  subjectKind: SubjectKind,
  subjectId: string,
  displayName: string,
  stats: PlayerStats,
  expiresAt: number | null,
): Promise<void> {
  const normalized = normalizeStats(stats);
  await db.query(
    `INSERT INTO player_stats(subject_kind, subject_id, stats, display_name, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (subject_kind, subject_id)
     DO UPDATE SET stats = EXCLUDED.stats, display_name = EXCLUDED.display_name,
                   expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at`,
    [subjectKind, subjectId, JSON.stringify(normalized), displayName, expiresAt, Date.now()],
  );
  await syncPowerupInventory(db, subjectKind, subjectId, normalized.powerUpCharges);
}

async function getPowerupInventory(
  db: DbClient,
  subjectKind: SubjectKind,
  subjectId: string,
): Promise<Record<string, number>> {
  const rows = await db.query<{ powerup_type: string; charges: number }>(
    `SELECT powerup_type, charges FROM powerup_inventory
     WHERE subject_kind = $1 AND subject_id = $2
     ORDER BY powerup_type`,
    [subjectKind, subjectId],
  );
  const inventory: Record<string, number> = {};
  for (const row of rows.rows) inventory[row.powerup_type] = Number(row.charges);
  if (inventory.POWERUP_CHARGE === undefined) {
    inventory.POWERUP_CHARGE = (await getStats(db, subjectKind, subjectId)).powerUpCharges;
  }
  return inventory;
}

async function syncPowerupInventory(
  db: DbClient,
  subjectKind: SubjectKind,
  subjectId: string,
  charges: number,
): Promise<void> {
  await db.query(
    `INSERT INTO powerup_inventory(subject_kind, subject_id, powerup_type, charges, updated_at)
     VALUES ($1, $2, 'POWERUP_CHARGE', $3, $4)
     ON CONFLICT (subject_kind, subject_id, powerup_type)
     DO UPDATE SET charges = EXCLUDED.charges, updated_at = EXCLUDED.updated_at`,
    [subjectKind, subjectId, Math.max(0, charges), Date.now()],
  );
}

async function syncLeaderboard(
  db: DbClient,
  subjectKind: SubjectKind,
  subjectId: string,
  displayName: string,
  rawStats: PlayerStats,
  expiresAt: number | null,
): Promise<number | null> {
  const stats = normalizeStats(rawStats);
  await db.query(
    `INSERT INTO leaderboard_entries(subject_kind, subject_id, display_name, total_points, wins, losses, category_points, expires_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (subject_kind, subject_id)
     DO UPDATE SET display_name = EXCLUDED.display_name, total_points = EXCLUDED.total_points,
                   wins = EXCLUDED.wins, losses = EXCLUDED.losses, category_points = EXCLUDED.category_points,
                   expires_at = EXCLUDED.expires_at, updated_at = EXCLUDED.updated_at`,
    [subjectKind, subjectId, displayName, stats.totalPoints, stats.wins, stats.losses, JSON.stringify(stats.categoryPoints), expiresAt, Date.now()],
  );
  await invalidateLeaderboardCaches();
  return await worldRank(db, subjectKind, subjectId);
}

async function worldRank(db: DbClient, subjectKind: SubjectKind, subjectId: string): Promise<number | null> {
  const result = await db.query<{ rank: string }>(
    `WITH ranked AS (
       SELECT subject_kind, subject_id,
              rank() OVER (ORDER BY total_points DESC, wins DESC, updated_at ASC) AS rank
       FROM leaderboard_entries
       WHERE total_points > 0 AND (expires_at IS NULL OR expires_at > $1)
     )
     SELECT rank FROM ranked WHERE subject_kind = $2 AND subject_id = $3`,
    [Date.now(), subjectKind, subjectId],
  );
  return result.rows[0] ? Number(result.rows[0].rank) : null;
}

async function getGuest(db: DbClient, guestId: string, forUpdate = false): Promise<GuestRow | null> {
  const result = await db.query<GuestRow>(
    `SELECT * FROM guests WHERE guest_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [guestId],
  );
  return result.rows[0] ?? null;
}

function toGuestDto(row: GuestRow, stats: PlayerStats): GuestSessionDto {
  return {
    kind: "GUEST",
    guestId: row.guest_id,
    displayName: row.display_name,
    expiresAt: Number(row.expires_at),
    stats: normalizeStats(stats),
  };
}

async function takeGuestSlot(db: DbClient): Promise<number> {
  const recycled = await db.query<{ slot: number }>(
    "DELETE FROM free_guest_slots WHERE slot = (SELECT slot FROM free_guest_slots ORDER BY slot LIMIT 1) RETURNING slot",
  );
  if (recycled.rows[0]) return recycled.rows[0].slot;
  const next = await db.query<{ slot: string }>("SELECT nextval('guest_slot_seq') AS slot");
  return Number(next.rows[0]!.slot);
}

async function releaseGuestSlot(db: DbClient, slot: number): Promise<void> {
  await db.query("INSERT INTO free_guest_slots(slot) VALUES ($1) ON CONFLICT DO NOTHING", [slot]);
}

async function retireGuest(client: DbClient, guestId: string): Promise<boolean> {
  const guest = await getGuest(client, guestId, true);
  if (!guest) return false;
  await client.query("DELETE FROM guests WHERE guest_id = $1", [guestId]);
  await client.query("DELETE FROM player_stats WHERE subject_kind = 'GUEST' AND subject_id = $1", [guestId]);
  await client.query("DELETE FROM leaderboard_entries WHERE subject_kind = 'GUEST' AND subject_id = $1", [guestId]);
  await client.query("DELETE FROM powerup_inventory WHERE subject_kind = 'GUEST' AND subject_id = $1", [guestId]);
  await releaseGuestSlot(client, guest.slot);
  return true;
}

async function claimGuestInTx(client: DbClient, guestId: string | null): Promise<PlayerStats | null> {
  if (!guestId) return null;
  const guest = await getGuest(client, guestId, true);
  if (!guest || Number(guest.expires_at) <= Date.now()) return null;
  const stats = await getStats(client, "GUEST", guestId);
  await retireGuest(client, guestId);
  return stats;
}

async function cleanupExpiredGuests(db: DbClient): Promise<void> {
  const expired = await db.query<GuestRow>("SELECT * FROM guests WHERE expires_at <= $1 LIMIT 500", [Date.now()]);
  if (expired.rowCount === 0) return;
  await tx(async (client) => {
    for (const guest of expired.rows) await retireGuest(client, guest.guest_id);
  });
}

async function touchPresence(db: DbClient, userId: string, match: { matchMode: string | null } | null): Promise<void> {
  const now = Date.now();
  const previous = await db.query<{ status: "IDLE" | "IN_MATCH"; match_mode: string | null; status_at: string | number }>(
    "SELECT status, match_mode, status_at FROM presence WHERE user_id = $1",
    [userId],
  );
  const status = match ? "IN_MATCH" : "IDLE";
  const prev = previous.rows[0];
  const statusAt = prev && prev.status === status && prev.match_mode === (match?.matchMode ?? null) ? Number(prev.status_at) : now;
  await db.query(
    `INSERT INTO presence(user_id, last_seen_at, status, match_mode, status_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id)
     DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, status = EXCLUDED.status,
                   match_mode = EXCLUDED.match_mode, status_at = EXCLUDED.status_at`,
    [userId, now, status, match?.matchMode ?? null, statusAt],
  );
}

async function sendPasswordResetEmail(record: UserRow, token: string): Promise<void> {
  const link = resetLink(process.env.PASSWORD_RESET_BASE_URL, token);
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
  const endpoint = process.env.PASSWORD_RESET_EMAIL_ENDPOINT;
  if (!endpoint) {
    console.info("Password reset email not configured; reset link:", link);
    return;
  }
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (process.env.PASSWORD_RESET_EMAIL_TOKEN) headers.Authorization = `Bearer ${process.env.PASSWORD_RESET_EMAIL_TOKEN}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify({
      to: record.email,
      from: process.env.PASSWORD_RESET_FROM ?? "no-reply@quizroyale.example",
      subject: "Reset your Quiz Royale password",
      text,
    }),
  });
  if (!response.ok) throw new Error(`email provider returned ${response.status}`);
}

function authorizedInternal(request: http.IncomingMessage): boolean {
  const expected = process.env.INTERNAL_API_TOKEN;
  if (!expected) return false;
  return request.headers["x-internal-token"] === expected;
}

function bearer(request: http.IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

async function safeJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

type ApiResponse = [number, unknown];

function sendResponse(response: http.ServerResponse, api: ApiResponse): void {
  send(response, api[0], api[1]);
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  for (const [key, value] of Object.entries(CORS)) response.setHeader(key, value);
  if (body === null) {
    response.writeHead(status);
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/json");
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

function isUnique(error: unknown, constraint: string): boolean {
  return typeof error === "object" && error !== null &&
    "code" in error && (error as { code?: string }).code === "23505" &&
    "constraint" in error && (error as { constraint?: string }).constraint === constraint;
}

function sanitizeGuestName(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, 16);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resetLink(base: string | undefined, token: string): string {
  const root = (base?.trim() || "quizroyale://reset-password").replace(/[?&]token=$/, "");
  return `${root}${root.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

process.on("SIGTERM", () => {
  server.close(() => {
    Promise.all([pool.end(), closeCache()]).finally(() => process.exit(0));
  });
});
