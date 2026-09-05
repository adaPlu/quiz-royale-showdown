import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";
import { URL, pathToFileURL } from "node:url";
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
import { cacheHealth, closeCache } from "./cache.js";
import {
  GUEST_TTL_MS,
  GOOGLE_PLAY_REVIEW_EMAIL,
  GOOGLE_PLAY_REVIEW_ROLE,
  GOOGLE_PLAY_REVIEW_USERNAME,
  REVIEW_ACCOUNT_BALANCE,
  SESSION_TTL_MS,
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
  type AuthResultDto,
  type CosmeticItemDto,
  type CurrencyKind,
  type FriendDto,
  type FriendInviteDto,
  type GuestSessionDto,
  type LeaderboardDto,
  type MatchOutcome,
  type PlayerStats,
  type PresenceRecord,
  type SeasonDto,
  type SeasonProgressDto,
  type SubjectKind,
  type StoreItemDto,
  type UserEntitlements,
  type UserProfileDto,
  type UserRole,
  type VirtualCurrencyBalances,
  publicLeaderboardSubjectId,
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
import { explicitReviewPassword } from "./runtime-config.js";
import { googlePlayHealthStatus } from "./commerce.js";
import {
  matchEconomyReward,
  parseEconomyReportWindow,
  seasonXpGain,
  summarizeEconomyLedger,
} from "./economy.js";

const PORT = Number.parseInt(process.env.PORT ?? "8080", 10);
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const MAX_FRIENDS = 200;
const DEFAULT_GUEST_NAME_BASE = "Challenger";
const MAX_GUEST_NAME_LENGTH = 16;
const MAX_JSON_BODY_BYTES = Number.parseInt(process.env.MAX_JSON_BODY_BYTES ?? "1048576", 10);
const AUTH_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const AUTH_RATE_LIMIT_MAX = Number.parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? "20", 10);
const GUEST_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const GUEST_RATE_LIMIT_MAX = Number.parseInt(process.env.GUEST_RATE_LIMIT_MAX ?? "240", 10);
const MAX_PENDING_INVITES = 50;
const SEASON_XP_PER_LEVEL = 1_000;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Internal-Token, X-Guest-Id, X-Guest-Secret",
};

const DEFAULT_BROWSER_ORIGINS = new Set([
  "https://quizroyale.gg",
  "https://www.quizroyale.gg",
  "https://play.quizroyale.gg",
  "https://quiz-royale-showdown.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);
const PAGES_PROJECT_HOST = "quiz-royale-showdown.pages.dev";

function corsOriginForRequest(request: http.IncomingMessage): string | null {
  const rawOrigin = request.headers.origin;
  if (typeof rawOrigin !== "string" || !rawOrigin.trim()) return "*";
  const origin = rawOrigin.trim().replace(/\/$/, "");
  const configured = [process.env.CORS_ORIGIN, process.env.CORS_ORIGINS]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().replace(/\/$/, ""))
    .filter(Boolean);
  if (DEFAULT_BROWSER_ORIGINS.has(origin) || configured.includes(origin)) return origin;
  try {
    const url = new URL(origin);
    if (url.protocol === "https:" && url.hostname.endsWith(`.${PAGES_PROJECT_HOST}`)) return origin;
  } catch {
    return null;
  }
  return null;
}

type UserRow = {
  user_id: string;
  username: string;
  username_lower: string;
  email: string;
  password_hash: string;
  role: UserRole;
  entitlements: UserEntitlements | null;
  currency_balances: VirtualCurrencyBalances | null;
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
  guest_secret_digest: string | null;
};

type FriendInviteStatus = "pending" | "accepted" | "declined" | "canceled";

type FriendInviteRow = {
  invite_id: string;
  from_user_id: string;
  from_username: string;
  to_user_id: string;
  to_username: string;
  status: FriendInviteStatus;
  created_at: string | number;
  responded_at: string | number | null;
};

type SeasonRow = {
  season_id: string;
  name: string;
  starts_at: string | number;
  ends_at: string | number;
  reward_track: unknown;
};

type SeasonProgressRow = {
  season_id: string;
  xp: number;
  level: number;
  tickets_earned: number;
  updated_at: string | number;
};

type StoreItemRow = {
  item_id: string;
  item_type: StoreItemDto["itemType"];
  display_name: string;
  description: string;
  currency: CurrencyKind;
  price: number;
  payload: Record<string, unknown> | null;
};

type CosmeticItemRow = {
  cosmetic_id: string;
  cosmetic_type: CosmeticItemDto["cosmeticType"];
  display_name: string;
  rarity: CosmeticItemDto["rarity"];
  payload: Record<string, unknown> | null;
  owned?: boolean;
  equipped?: boolean;
};

type MatchAppearanceCosmetic = {
  cosmeticId: string;
  displayName: string;
};

type MatchAppearance = {
  avatarFrame: MatchAppearanceCosmetic | null;
  banner: MatchAppearanceCosmetic | null;
  title: MatchAppearanceCosmetic | null;
  badge: MatchAppearanceCosmetic | null;
};

const matchOutcomeSchema = z.object({
  matchId: z.string().min(1),
  subjectKind: z.enum(["USER", "GUEST"]),
  subjectId: z.string().min(1),
  displayName: z.string().min(1),
  won: z.boolean(),
  placement: z.number().int().positive().nullable(),
  score: z.number().int().nonnegative().max(1_000_000),
  correctAnswers: z.number().int().nonnegative(),
  powerUpsUsed: z.number().int().nonnegative().max(100),
  categoryPoints: z.record(z.number().int().nonnegative().max(1_000_000)),
  recordWinLoss: z.boolean(),
  competitiveRewards: z.boolean().optional(),
});

export function createQuizRoyaleApiServer(): http.Server {
  return http.createServer(handleRequest);
}

export async function handleRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
  try {
    const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin.trim() : "";
    const allowedOrigin = corsOriginForRequest(request);
    if (requestOrigin && !allowedOrigin) {
      response.writeHead(403);
      response.end();
      return;
    }
    if (allowedOrigin) response.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    if (requestOrigin) response.setHeader("Vary", "Origin");
    if (request.method === "OPTIONS") return send(response, 204, null);
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendResponse(response, await healthStatus());
    }

    if (request.method === "POST" && url.pathname === "/auth/register") return sendResponse(response, await rateLimited(request, "register", () => register(request)));
    if (request.method === "POST" && url.pathname === "/auth/login") return sendResponse(response, await rateLimited(request, "login", () => login(request)));
    if (request.method === "POST" && url.pathname === "/auth/logout") return sendResponse(response, await logout(request));
    if (request.method === "POST" && url.pathname === "/auth/forgot-password") return sendResponse(response, await rateLimited(request, "forgot-password", () => forgotPassword(request)));
    if (request.method === "POST" && url.pathname === "/auth/reset-password") return sendResponse(response, await rateLimited(request, "reset-password", () => resetPassword(request)));
    if (request.method === "GET" && url.pathname === "/auth/me") return sendResponse(response, await me(request));
    if (request.method === "GET" && url.pathname === "/auth/resolve") return sendResponse(response, await resolveUser(request));

    if (request.method === "POST" && url.pathname === "/guest/session") return sendResponse(response, await rateLimited(request, "guest-session", () => guestSession(request), GUEST_RATE_LIMIT_MAX, GUEST_RATE_LIMIT_WINDOW_MS));
    if (request.method === "POST" && url.pathname === "/guest/heartbeat") return sendResponse(response, await rateLimited(request, "guest-heartbeat", () => guestHeartbeat(request), GUEST_RATE_LIMIT_MAX, GUEST_RATE_LIMIT_WINDOW_MS));
    if (request.method === "POST" && url.pathname === "/guest/end") return sendResponse(response, await rateLimited(request, "guest-end", () => guestEnd(request), GUEST_RATE_LIMIT_MAX, GUEST_RATE_LIMIT_WINDOW_MS));
    if (request.method === "GET" && url.pathname === "/guest/me") return sendResponse(response, await guestMe(request, url));
    if (request.method === "GET" && url.pathname === "/internal/guest/resolve") return sendResponse(response, await resolveGuest(request, url));
    if (request.method === "POST" && url.pathname === "/internal/guest/claim") return sendResponse(response, await claimGuest(request));

    if (request.method === "GET" && url.pathname === "/friends") return sendResponse(response, await listFriends(request));
    if (request.method === "POST" && url.pathname === "/friends/add") return sendResponse(response, await sendFriendInvite(request));
    if (request.method === "POST" && url.pathname === "/friends/remove") return sendResponse(response, await removeFriend(request));
    if (request.method === "GET" && url.pathname === "/friends/invites") return sendResponse(response, await listFriendInvites(request));
    if (request.method === "POST" && url.pathname === "/friends/invites") return sendResponse(response, await sendFriendInvite(request));
    if (request.method === "POST" && url.pathname === "/friends/invites/respond") return sendResponse(response, await respondFriendInvite(request));
    if (request.method === "GET" && url.pathname === "/users/search") return sendResponse(response, await rateLimited(request, "user-search", () => searchUsers(request, url)));
    if (request.method === "POST" && url.pathname === "/presence/ping") return sendResponse(response, await presencePing(request));
    if (request.method === "POST" && url.pathname === "/internal/presence") return sendResponse(response, await internalPresence(request));
    if (request.method === "GET" && url.pathname === "/powerups") return sendResponse(response, await powerups(request, url));
    if (request.method === "GET" && url.pathname === "/seasons/current") return sendResponse(response, await currentSeason(request));
    if (request.method === "GET" && url.pathname === "/store/items") return sendResponse(response, await storeItems(request));
    if (request.method === "POST" && url.pathname === "/store/purchase") return sendResponse(response, await purchaseStoreItem(request));
    if (request.method === "GET" && url.pathname === "/cosmetics") return sendResponse(response, await cosmetics(request));
    if (request.method === "POST" && url.pathname === "/cosmetics/equip") return sendResponse(response, await equipCosmetic(request));

    if (request.method === "GET" && url.pathname === "/leaderboard/boards") return send(response, 200, { boards: [WORLD_BOARD, ...CATEGORIES] });
    if (request.method === "GET" && url.pathname === "/leaderboard") {
      return sendResponse(response, await cachedLeaderboard(url.search || "default", () => leaderboard(url)));
    }
    if (request.method === "GET" && url.pathname === "/internal/economy-report") return sendResponse(response, await internalEconomyReport(request, url));
    if (request.method === "POST" && url.pathname === "/internal/report") return sendResponse(response, await internalReport(request));
    if (request.method === "POST" && url.pathname === "/internal/questions/select") return sendResponse(response, await internalQuestionSelect(request));
    if (request.method === "POST" && url.pathname === "/internal/questions/usage") return sendResponse(response, await internalQuestionUsage(request));
    if (request.method === "POST" && url.pathname === "/internal/questions/generate") return sendResponse(response, await internalQuestionGenerate(request));

    return send(response, 404, { error: "not_found" });
  } catch (error) {
    if ((error as { statusCode?: number })?.statusCode === 413) {
      return send(response, 413, { error: "payload_too_large", message: "Request body is too large." });
    }
    console.error("request failed", request.method, request.url, (error as Error)?.message);
    return send(response, 500, { error: "internal_error", message: "Something went wrong." });
  }
}

export const server = createQuizRoyaleApiServer();

if (isMainModule()) {
  start().catch((error) => {
    console.error("startup failed", (error as Error)?.message);
    process.exitCode = 1;
  });

  process.on("SIGTERM", () => {
    server.close(() => {
      Promise.all([pool.end(), closeCache()]).finally(() => process.exit(0));
    });
  });
}

async function start(): Promise<void> {
  await ensureGooglePlayReviewAccount();
  server.listen(PORT, () => {
    console.log(`quiz-royale-api listening on ${PORT}`);
  });
}

async function healthStatus(): Promise<ApiResponse> {
  const now = Date.now();
  let postgres: "connected" | "error" = "connected";
  try {
    await pool.query("SELECT 1");
  } catch {
    postgres = "error";
  }

  const redis = await cacheHealth();
  const googlePlay = googlePlayHealthStatus();
  let season: { seasonId: string; endsAt: number } | null = null;
  if (postgres === "connected") {
    const current = await getActiveSeason(pool).catch(() => null);
    if (current) season = { seasonId: current.season_id, endsAt: Number(current.ends_at) };
  }

  const ok = postgres === "connected";
  return [ok ? 200 : 503, {
    ok,
    service: "quiz-royale-api",
    now,
    version: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    dependencies: {
      postgres,
      redis,
      googlePlay,
      rtdn: process.env.GOOGLE_PLAY_RTDN_AUDIENCE?.trim() &&
        process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL?.trim()
        ? "configured"
        : "not_configured",
    },
    season,
  }];
}

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
  const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : null;
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
        const claimed = await claimGuestInTx(client, guestId, guestSecret);
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
      const profile = await toProfile(client, {
        user_id: userId,
        username: username.value,
        username_lower: username.value.toLowerCase(),
        email: email.value,
        password_hash: passwordHash,
        role: "player",
        entitlements: null,
        currency_balances: null,
        created_at: now,
        last_login_at: now,
      });
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

  if (isReviewAccountIdentifier(identifier)) {
    const reviewer = await ensureGooglePlayReviewAccount();
    if (!reviewer) {
      return [503, {
        error: "reviewer_access_not_configured",
        message: "The Play review account is not configured."
      }];
    }
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
  const entitlements = normalizeEntitlements(record.entitlements);
  return [200, {
    userId: record.user_id,
    username: record.username,
    role: userRole(record),
    entitlements,
    currencyBalances: currencyBalancesFor(record),
    powerUpCharges: entitlements.unlimitedCurrency ? REVIEW_ACCOUNT_BALANCE : stats.powerUpCharges,
    appearance: await equippedMatchAppearance(pool, record.user_id),
  }];
}

async function guestSession(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const displayName = sanitizeGuestName(body.displayName);
  const existingId = typeof body.guestId === "string" ? body.guestId : null;
  const existingSecret = typeof body.guestSecret === "string" ? body.guestSecret : null;

  const result = await tx(async (client) => {
    if (existingId) {
      const existing = await getGuest(client, existingId, true);
      if (existing && Number(existing.expires_at) > Date.now() && validGuestSecret(existing, existingSecret)) {
        const now = Date.now();
        const expiresAt = now + GUEST_TTL_MS;
        const name = displayName
          ? await availableGuestDisplayName(client, displayName, existing.guest_id)
          : isLegacyAutoGuestDisplayName(existing.display_name)
            ? await availableGuestDisplayName(client, "", existing.guest_id)
          : existing.display_name;
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
    const guestId = `g${slot}-${crypto.randomUUID().replace(/-/g, "")}`;
    const guestSecret = mintGuestSecret();
    const name = await availableGuestDisplayName(client, displayName);
    const expiresAt = now + GUEST_TTL_MS;
    const stats = emptyStats();
    await client.query(
      "INSERT INTO guests(guest_id, slot, display_name, created_at, last_seen_at, expires_at, guest_secret_digest) VALUES ($1, $2, $3, $4, $4, $5, $6)",
      [guestId, slot, name, now, expiresAt, sha256Hex(guestSecret)],
    );
    await putStats(client, "GUEST", guestId, name, stats, expiresAt);
    return { session: toGuestDto({ guest_id: guestId, slot, display_name: name, created_at: now, last_seen_at: now, expires_at: expiresAt, guest_secret_digest: sha256Hex(guestSecret) }, stats, guestSecret), reused: false };
  });
  return [result.reused ? 200 : 201, { guest: result.session, reused: result.reused }];
}

async function guestHeartbeat(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const guestId = typeof body.guestId === "string" ? body.guestId : "";
  const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : "";
  const result = await tx(async (client) => {
    const guest = await getGuest(client, guestId, true);
    if (!guest || Number(guest.expires_at) <= Date.now()) return null;
    if (!validGuestSecret(guest, guestSecret)) return "unauthorized" as const;
    const now = Date.now();
    const expiresAt = now + GUEST_TTL_MS;
    await client.query("UPDATE guests SET last_seen_at = $2, expires_at = $3 WHERE guest_id = $1", [guestId, now, expiresAt]);
    const stats = await getStats(client, "GUEST", guestId);
    await putStats(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    await syncLeaderboard(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    return toGuestDto({ ...guest, last_seen_at: now, expires_at: expiresAt }, stats);
  });
  if (result === "unauthorized") return [401, { error: "unauthorized" }];
  if (!result) return [404, { error: "guest_expired", message: "This guest session has expired." }];
  return [200, { guest: result }];
}

async function guestEnd(request: http.IncomingMessage): Promise<ApiResponse> {
  const body = await safeJson(request);
  const guestId = typeof body.guestId === "string" ? body.guestId : "";
  const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : "";
  const retired = await tx(async (client) => {
    const guest = await getGuest(client, guestId, true);
    if (!guest) return false;
    if (!validGuestSecret(guest, guestSecret)) return "unauthorized" as const;
    return retireGuest(client, guestId);
  });
  if (retired === "unauthorized") return [401, { error: "unauthorized" }];
  return [200, { ok: true, retired }];
}

async function guestMe(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {
  const guestId = headerValue(request, "x-guest-id");
  const guestSecret = headerValue(request, "x-guest-secret");
  const guest = await getGuest(pool, guestId);
  if (!guest || Number(guest.expires_at) <= Date.now()) return [404, { error: "guest_expired" }];
  if (!validGuestSecret(guest, guestSecret)) return [401, { error: "unauthorized" }];
  return [200, { guest: toGuestDto(guest, await getStats(pool, "GUEST", guestId)) }];
}

async function resolveGuest(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const guestId = headerValue(request, "x-guest-id");
  const guestSecret = headerValue(request, "x-guest-secret");
  const result = await tx(async (client) => {
    const guest = await getGuest(client, guestId, true);
    if (!guest || Number(guest.expires_at) <= Date.now()) return null;
    if (!validGuestSecret(guest, guestSecret)) return "unauthorized" as const;
    const now = Date.now();
    const expiresAt = now + GUEST_TTL_MS;
    await client.query("UPDATE guests SET last_seen_at = $2, expires_at = $3 WHERE guest_id = $1", [guestId, now, expiresAt]);
    const stats = await getStats(client, "GUEST", guestId);
    await putStats(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    await syncLeaderboard(client, "GUEST", guestId, guest.display_name, stats, expiresAt);
    return { guestId, displayName: guest.display_name, powerUpCharges: stats.powerUpCharges };
  });
  if (result === "unauthorized") return [401, { error: "unauthorized" }];
  if (!result) return [404, { error: "guest_expired" }];
  return [200, result];
}

async function claimGuest(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const guestId = typeof body.guestId === "string" ? body.guestId : "";
  const guestSecret = typeof body.guestSecret === "string" ? body.guestSecret : "";
  const stats = await tx(async (client) => claimGuestInTx(client, guestId, guestSecret));
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

async function listFriendInvites(request: http.IncomingMessage): Promise<ApiResponse> {
  const meRow = await authenticate(request);
  if (!meRow) return [401, { error: "unauthorized" }];
  await touchPresence(pool, meRow.user_id, null);
  return [200, await friendInvitesPayload(pool, meRow.user_id)];
}

async function sendFriendInvite(request: http.IncomingMessage): Promise<ApiResponse> {
  const meRow = await authenticate(request);
  if (!meRow) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const username = typeof body.username === "string" ? body.username.trim() : "";
  if (!username) return [400, { error: "validation_failed", message: "Enter a username." }];

  const result = await tx(async (client) => {
    const target = await findUserByIdentifier(client, username);
    if (!target) return { status: 404 as const, body: { error: "not_found", message: "No player with that username." } };
    if (target.user_id === meRow.user_id) return { status: 400 as const, body: { error: "invalid", message: "You cannot invite yourself." } };
    const existingFriend = await client.query(
      "SELECT 1 FROM friendships WHERE user_id = $1 AND friend_user_id = $2",
      [meRow.user_id, target.user_id],
    );
    if (existingFriend.rowCount) return { status: 409 as const, body: { error: "already_friends", message: `${target.username} is already a friend.` } };
    const inbound = await client.query<{ invite_id: string }>(
      `SELECT invite_id FROM friend_invites
       WHERE from_user_id = $1 AND to_user_id = $2 AND status = 'pending'
       LIMIT 1`,
      [target.user_id, meRow.user_id],
    );
    if (inbound.rows[0]) {
      return await acceptFriendInviteInTx(client, meRow, inbound.rows[0].invite_id);
    }
    const pending = await client.query<{ count: string }>(
      "SELECT count(*) FROM friend_invites WHERE from_user_id = $1 AND status = 'pending'",
      [meRow.user_id],
    );
    if (Number(pending.rows[0]?.count ?? 0) >= MAX_PENDING_INVITES) {
      return { status: 409 as const, body: { error: "limit_reached", message: "You have too many pending invites." } };
    }

    const now = Date.now();
    await client.query(
      `INSERT INTO friend_invites(invite_id, from_user_id, to_user_id, status, created_at)
       VALUES ($1, $2, $3, 'pending', $4)
       ON CONFLICT DO NOTHING`,
      [`fi-${crypto.randomUUID()}`, meRow.user_id, target.user_id, now],
    );
    return { status: 201 as const, body: { ok: true, ...(await friendInvitesPayload(client, meRow.user_id)) } };
  });
  return [result.status, result.body];
}

async function respondFriendInvite(request: http.IncomingMessage): Promise<ApiResponse> {
  const meRow = await authenticate(request);
  if (!meRow) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const inviteId = typeof body.inviteId === "string" ? body.inviteId.trim() : "";
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";
  if (!inviteId) return [400, { error: "validation_failed", message: "Missing invite id." }];
  if (!["accept", "decline", "cancel"].includes(action)) {
    return [400, { error: "validation_failed", message: "Unsupported invite action." }];
  }

  const result = await tx(async (client) => {
    if (action === "accept") return await acceptFriendInviteInTx(client, meRow, inviteId);
    const invite = await getPendingFriendInvite(client, inviteId);
    if (!invite) return { status: 404 as const, body: { error: "not_found", message: "That invite is no longer pending." } };
    if (action === "decline" && invite.to_user_id !== meRow.user_id) {
      return { status: 403 as const, body: { error: "forbidden", message: "Only the invited player can decline this invite." } };
    }
    if (action === "cancel" && invite.from_user_id !== meRow.user_id) {
      return { status: 403 as const, body: { error: "forbidden", message: "Only the sender can cancel this invite." } };
    }
    await client.query(
      "UPDATE friend_invites SET status = $2, responded_at = $3 WHERE invite_id = $1",
      [inviteId, action === "decline" ? "declined" : "canceled", Date.now()],
    );
    return { status: 200 as const, body: { ok: true, ...(await friendInvitesPayload(client, meRow.user_id)) } };
  });
  return [result.status, result.body];
}

async function searchUsers(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {
  const meRow = await authenticate(request);
  if (!meRow) return [401, { error: "unauthorized" }];
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
  await safeJson(request);
  await touchPresence(pool, meRow.user_id, null);
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
    const inventory = await getPowerupInventory(pool, "USER", record.user_id);
    if (normalizeEntitlements(record.entitlements).unlimitedCurrency) {
      inventory.POWERUP_CHARGE = REVIEW_ACCOUNT_BALANCE;
    }
    return [200, { inventory }];
  }

  const guestId = headerValue(request, "x-guest-id");
  const guestSecret = headerValue(request, "x-guest-secret");
  if (!guestId) return [401, { error: "unauthorized" }];
  const guest = await getGuest(pool, guestId);
  if (!guest || Number(guest.expires_at) <= Date.now()) return [404, { error: "guest_expired" }];
  if (!validGuestSecret(guest, guestSecret)) return [401, { error: "unauthorized" }];
  return [200, { inventory: await getPowerupInventory(pool, "GUEST", guestId) }];
}

async function currentSeason(request: http.IncomingMessage): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  const season = await getActiveSeason(pool);
  if (!season) return [404, { error: "not_found", message: "No active season is configured." }];
  const progress = await getSeasonProgress(pool, record.user_id, season.season_id);
  const hasPass = await hasSeasonPass(pool, record.user_id, season.season_id, record.entitlements);
  return [200, { season: seasonDto(season), progress, hasSeasonPass: hasPass }];
}

async function storeItems(request: http.IncomingMessage): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  return [200, {
    balances: currencyBalancesFor(record),
    items: await hydrateStoreItems(pool, record),
  }];
}

async function purchaseStoreItem(request: http.IncomingMessage): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim().slice(0, 120) : "";
  if (!itemId || !idempotencyKey) {
    return [400, { error: "validation_failed", message: "Missing store item or idempotency key." }];
  }

  const result = await tx(async (client) => {
    const user = await getUserForUpdate(client, record.user_id);
    if (!user) return { status: 404 as const, body: { error: "not_found" } };
    const existing = await client.query(
      "SELECT 1 FROM store_purchases WHERE user_id = $1 AND idempotency_key = $2",
      [user.user_id, idempotencyKey],
    );
    if (existing.rowCount) {
      return {
        status: 200 as const,
        body: await storeStatePayload(client, user, { duplicate: true }),
      };
    }

    const item = await getStoreItem(client, itemId);
    if (!item) return { status: 404 as const, body: { error: "not_found", message: "That store item is unavailable." } };
    const entitlements = normalizeEntitlements(user.entitlements);
    if (item.item_type === "COSMETIC") {
      const cosmeticId = storePayloadString(item.payload, "cosmeticId");
      if (!cosmeticId) return { status: 409 as const, body: { error: "invalid_item", message: "This cosmetic item is misconfigured." } };
      const owned = await ownsCosmetic(client, user.user_id, cosmeticId);
      if (owned || entitlements.allStoreItemsUnlocked) {
        return { status: 409 as const, body: { error: "already_owned", message: "You already own this cosmetic." } };
      }
    }
    if (item.item_type === "SEASON_PASS") {
      const seasonId = storePayloadString(item.payload, "seasonId");
      if (!seasonId) return { status: 409 as const, body: { error: "invalid_item", message: "This season pass is misconfigured." } };
      if (!await seasonIsCurrent(client, seasonId)) {
        return { status: 409 as const, body: { error: "season_not_current", message: "That season pass is not currently available." } };
      }
      if (await hasSeasonPass(client, user.user_id, seasonId, user.entitlements)) {
        return { status: 409 as const, body: { error: "already_owned", message: "You already own this season pass." } };
      }
    }

    if (!entitlements.unlimitedCurrency && item.price > 0) {
      const debit = await adjustCurrency(client, user, item.currency, -item.price, "store_purchase", idempotencyKey);
      if (!debit.ok) return { status: 409 as const, body: { error: "insufficient_funds", message: "Not enough currency." } };
      user.currency_balances = debit.balances;
    }

    const purchaseId = `sp-${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO store_purchases(purchase_id, user_id, item_id, idempotency_key, currency, price, purchased_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [purchaseId, user.user_id, item.item_id, idempotencyKey, item.currency, item.price, Date.now()],
    );
    await grantStoreItem(client, user, item);
    return {
      status: 200 as const,
      body: await storeStatePayload(client, user, { duplicate: false, purchaseId }),
    };
  });
  return [result.status, result.body];
}

async function cosmetics(request: http.IncomingMessage): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  return [200, { cosmetics: await hydrateCosmetics(pool, record) }];
}

async function equipCosmetic(request: http.IncomingMessage): Promise<ApiResponse> {
  const record = await authenticate(request);
  if (!record) return [401, { error: "unauthorized" }];
  const body = await safeJson(request);
  const cosmeticId = typeof body.cosmeticId === "string" ? body.cosmeticId.trim() : "";
  if (!cosmeticId) return [400, { error: "validation_failed", message: "Missing cosmetic id." }];

  const result = await tx(async (client) => {
    const user = await getUserForUpdate(client, record.user_id);
    if (!user) return { status: 404 as const, body: { error: "not_found" } };
    const cosmetic = await getCosmeticItem(client, cosmeticId);
    if (!cosmetic) return { status: 404 as const, body: { error: "not_found", message: "That cosmetic is unavailable." } };
    const entitlements = normalizeEntitlements(user.entitlements);
    if (!entitlements.allStoreItemsUnlocked && !await ownsCosmetic(client, user.user_id, cosmeticId)) {
      return { status: 403 as const, body: { error: "not_owned", message: "Unlock this cosmetic before equipping it." } };
    }
    if (entitlements.allStoreItemsUnlocked && !await ownsCosmetic(client, user.user_id, cosmeticId)) {
      await grantCosmetic(client, user.user_id, cosmeticId, "entitlement");
    }
    await client.query(
      `INSERT INTO equipped_cosmetics(user_id, cosmetic_type, cosmetic_id, equipped_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, cosmetic_type)
       DO UPDATE SET cosmetic_id = EXCLUDED.cosmetic_id, equipped_at = EXCLUDED.equipped_at`,
      [user.user_id, cosmetic.cosmetic_type, cosmeticId, Date.now()],
    );
    return { status: 200 as const, body: { ok: true, cosmetics: await hydrateCosmetics(client, user) } };
  });
  return [result.status, result.body];
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
      subjectId: publicLeaderboardSubjectId(row.subject_kind, row.subject_id),
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

async function internalEconomyReport(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];
  const window = parseEconomyReportWindow(url.searchParams.get("windowMs"));
  if (!window) return [400, { error: "invalid_window" }];

  const ledger = await pool.query<{
    currency: string;
    reason: string;
    delta: string | number;
    event_count: string | number;
  }>(
    `SELECT currency, reason, COALESCE(SUM(delta), 0) AS delta, COUNT(*) AS event_count
     FROM currency_ledger
     WHERE created_at >= $1 AND created_at <= $2
     GROUP BY currency, reason
     ORDER BY currency, reason`,
    [window.from, window.to],
  );
  const purchases = await pool.query<{
    currency: string;
    purchase_count: string | number;
    spend: string | number;
  }>(
    `SELECT currency, COUNT(*) AS purchase_count, COALESCE(SUM(price), 0) AS spend
     FROM store_purchases
     WHERE purchased_at >= $1 AND purchased_at <= $2
     GROUP BY currency
     ORDER BY currency`,
    [window.from, window.to],
  );

  const summary = summarizeEconomyLedger(ledger.rows.map((row) => ({
    currency: row.currency,
    reason: row.reason,
    delta: Number(row.delta),
    eventCount: Number(row.event_count),
  })));
  const storePurchases: Record<string, { purchases: number; spend: number }> = {
    coins: { purchases: 0, spend: 0 },
    gems: { purchases: 0, spend: 0 },
    seasonalTickets: { purchases: 0, spend: 0 },
  };
  for (const row of purchases.rows) {
    if (!(row.currency in storePurchases)) continue;
    storePurchases[row.currency] = {
      purchases: Number(row.purchase_count),
      spend: Number(row.spend),
    };
  }

  return [200, { window, ...summary, storePurchases }];
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

  // Older workers did not send competitiveRewards. recordWinLoss was already
  // false for Practice, so it is the safe compatibility fallback.
  const competitive = outcome.competitiveRewards ?? outcome.recordWinLoss;

  if (outcome.subjectKind === "GUEST") {
    const guest = await getGuest(client, outcome.subjectId, true);
    if (!guest || Number(guest.expires_at) <= Date.now()) return null;
    const now = Date.now();
    const expiresAt = now + GUEST_TTL_MS;
    await client.query("UPDATE guests SET last_seen_at = $2, expires_at = $3 WHERE guest_id = $1", [outcome.subjectId, now, expiresAt]);
    const base = await getStats(client, "GUEST", outcome.subjectId);
    if (!competitive) return { duplicate: false, stats: base };

    const stats = applyOutcome(base, outcome);
    await putStats(client, "GUEST", outcome.subjectId, guest.display_name, stats, expiresAt);
    const rank = await syncLeaderboard(client, "GUEST", outcome.subjectId, guest.display_name, stats, expiresAt);
    const ranked = applyRank(stats, rank);
    await putStats(client, "GUEST", outcome.subjectId, guest.display_name, ranked, expiresAt);
    await syncLeaderboard(client, "GUEST", outcome.subjectId, guest.display_name, ranked, expiresAt);
    return { duplicate: false, stats: ranked };
  }

  const user = await getUserForUpdate(client, outcome.subjectId);
  if (!user) return null;
  const base = await getStats(client, "USER", outcome.subjectId);
  if (!competitive) return { duplicate: false, stats: base };

  const stats = applyOutcome(base, outcome);
  await putStats(client, "USER", outcome.subjectId, user.username, stats, null);
  await awardCurrencyForMatch(client, user, outcome);
  await awardSeasonProgressForMatch(client, user, outcome);
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

async function getUserForUpdate(db: DbClient, userId: string): Promise<UserRow | null> {
  const result = await db.query<UserRow>("SELECT * FROM users WHERE user_id = $1 FOR UPDATE", [userId]);
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
  const entitlements = normalizeEntitlements(record.entitlements);
  return {
    kind: "USER",
    userId: record.user_id,
    username: record.username,
    email: record.email,
    role: userRole(record),
    entitlements,
    currencyBalances: currencyBalancesFor(record),
    createdAt: Number(record.created_at),
    stats: entitlements.unlimitedCurrency
      ? applyReviewAccountAccess(await getStats(db, "USER", record.user_id))
      : await getStats(db, "USER", record.user_id),
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

async function friendInvitesPayload(db: DbClient, userId: string): Promise<{ incoming: FriendInviteDto[]; outgoing: FriendInviteDto[] }> {
  const rows = await db.query<FriendInviteRow>(
    `SELECT fi.invite_id, fi.from_user_id, from_user.username AS from_username,
            fi.to_user_id, to_user.username AS to_username,
            fi.status, fi.created_at, fi.responded_at
     FROM friend_invites fi
     JOIN users from_user ON from_user.user_id = fi.from_user_id
     JOIN users to_user ON to_user.user_id = fi.to_user_id
     WHERE fi.status = 'pending' AND (fi.from_user_id = $1 OR fi.to_user_id = $1)
     ORDER BY fi.created_at DESC`,
    [userId],
  );
  const incoming: FriendInviteDto[] = [];
  const outgoing: FriendInviteDto[] = [];
  for (const row of rows.rows) {
    if (row.to_user_id === userId) incoming.push(friendInviteDto(row, "incoming"));
    if (row.from_user_id === userId) outgoing.push(friendInviteDto(row, "outgoing"));
  }
  return { incoming, outgoing };
}

function friendInviteDto(row: FriendInviteRow, direction: FriendInviteDto["direction"]): FriendInviteDto {
  const otherIsSender = direction === "incoming";
  return {
    inviteId: row.invite_id,
    direction,
    status: row.status,
    userId: otherIsSender ? row.from_user_id : row.to_user_id,
    username: otherIsSender ? row.from_username : row.to_username,
    createdAt: Number(row.created_at),
    respondedAt: row.responded_at === null ? null : Number(row.responded_at),
  };
}

async function getPendingFriendInvite(db: DbClient, inviteId: string): Promise<FriendInviteRow | null> {
  const result = await db.query<FriendInviteRow>(
    `SELECT fi.invite_id, fi.from_user_id, from_user.username AS from_username,
            fi.to_user_id, to_user.username AS to_username,
            fi.status, fi.created_at, fi.responded_at
     FROM friend_invites fi
     JOIN users from_user ON from_user.user_id = fi.from_user_id
     JOIN users to_user ON to_user.user_id = fi.to_user_id
     WHERE fi.invite_id = $1 AND fi.status = 'pending'
     FOR UPDATE OF fi`,
    [inviteId],
  );
  return result.rows[0] ?? null;
}

async function acceptFriendInviteInTx(
  client: DbClient,
  meRow: UserRow,
  inviteId: string,
): Promise<{ status: number; body: unknown }> {
  const invite = await getPendingFriendInvite(client, inviteId);
  if (!invite) return { status: 404, body: { error: "not_found", message: "That invite is no longer pending." } };
  if (invite.to_user_id !== meRow.user_id) {
    return { status: 403, body: { error: "forbidden", message: "Only the invited player can accept this invite." } };
  }
  const count = await client.query<{ count: string }>("SELECT count(*) FROM friendships WHERE user_id = $1", [meRow.user_id]);
  if (Number(count.rows[0]?.count ?? 0) >= MAX_FRIENDS) {
    return { status: 409, body: { error: "limit_reached", message: "Your friends list is full." } };
  }
  const now = Date.now();
  await client.query(
    `INSERT INTO friendships(user_id, friend_user_id, added_at)
     VALUES ($1, $2, $3), ($2, $1, $3)
     ON CONFLICT (user_id, friend_user_id) DO NOTHING`,
    [invite.from_user_id, invite.to_user_id, now],
  );
  await client.query(
    "UPDATE friend_invites SET status = 'accepted', responded_at = $2 WHERE invite_id = $1",
    [inviteId, now],
  );
  return {
    status: 200,
    body: {
      ok: true,
      profile: await toProfile(client, meRow),
      ...(await friendInvitesPayload(client, meRow.user_id)),
    },
  };
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

async function getActiveSeason(db: DbClient): Promise<SeasonRow | null> {
  const now = Date.now();
  const result = await db.query<SeasonRow>(
    `SELECT season_id, name, starts_at, ends_at, reward_track
     FROM seasons
     WHERE starts_at <= $1 AND ends_at > $1
     ORDER BY active DESC, starts_at DESC, created_at DESC, season_id
     LIMIT 1`,
    [now],
  );
  return result.rows[0] ?? null;
}

async function seasonIsCurrent(db: DbClient, seasonId: string): Promise<boolean> {
  const now = Date.now();
  const result = await db.query(
    "SELECT 1 FROM seasons WHERE season_id = $1 AND starts_at <= $2 AND ends_at > $2",
    [seasonId, now],
  );
  return Boolean(result.rowCount);
}

function seasonDto(row: SeasonRow): SeasonDto {
  return {
    seasonId: row.season_id,
    name: row.name,
    startsAt: Number(row.starts_at),
    endsAt: Number(row.ends_at),
    rewardTrack: Array.isArray(row.reward_track) ? row.reward_track : [],
  };
}

async function getSeasonProgress(db: DbClient, userId: string, seasonId: string): Promise<SeasonProgressDto> {
  const result = await db.query<SeasonProgressRow>(
    `SELECT season_id, xp, level, tickets_earned, updated_at
     FROM season_progress
     WHERE user_id = $1 AND season_id = $2`,
    [userId, seasonId],
  );
  const row = result.rows[0];
  if (!row) return { seasonId, xp: 0, level: 1, ticketsEarned: 0, updatedAt: 0 };
  return {
    seasonId: row.season_id,
    xp: Number(row.xp),
    level: Number(row.level),
    ticketsEarned: Number(row.tickets_earned),
    updatedAt: Number(row.updated_at),
  };
}

async function awardSeasonProgressForMatch(client: DbClient, user: UserRow, outcome: MatchOutcome): Promise<void> {
  const season = await getActiveSeason(client);
  if (!season) return;
  const xpGain = seasonXpGain(outcome.score, outcome.correctAnswers, outcome.won);
  const previous = await getSeasonProgress(client, user.user_id, season.season_id);
  const xp = previous.xp + xpGain;
  const level = Math.max(1, Math.floor(xp / SEASON_XP_PER_LEVEL) + 1);
  const newLevels = Math.max(0, level - previous.level);
  const tickets = previous.ticketsEarned + newLevels;
  await client.query(
    `INSERT INTO season_progress(user_id, season_id, xp, level, tickets_earned, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, season_id)
     DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level,
                   tickets_earned = EXCLUDED.tickets_earned, updated_at = EXCLUDED.updated_at`,
    [user.user_id, season.season_id, xp, level, tickets, Date.now()],
  );
  if (newLevels > 0) {
    const credit = await adjustCurrency(client, user, "seasonalTickets", newLevels, "season_level", `${season.season_id}:${level}`);
    if (credit.ok) user.currency_balances = credit.balances;
  }
}

async function awardCurrencyForMatch(client: DbClient, user: UserRow, outcome: MatchOutcome): Promise<void> {
  if (normalizeEntitlements(user.entitlements).unlimitedCurrency) return;
  const { coins, gems } = matchEconomyReward(outcome.score, outcome.correctAnswers, outcome.won);
  const coinCredit = await adjustCurrency(client, user, "coins", coins, "match_reward", outcome.matchId);
  if (coinCredit.ok) user.currency_balances = coinCredit.balances;
  if (gems > 0) {
    const gemCredit = await adjustCurrency(client, user, "gems", gems, "match_win", outcome.matchId);
    if (gemCredit.ok) user.currency_balances = gemCredit.balances;
  }
}

async function hasSeasonPass(
  db: DbClient,
  userId: string,
  seasonId: string,
  rawEntitlements: unknown,
): Promise<boolean> {
  // Reviewer/premium operational accounts retain global access. Player season
  // passes are otherwise scoped by season_id in user_season_passes.
  if (normalizeEntitlements(rawEntitlements).premiumAccess) return true;
  const result = await db.query(
    "SELECT 1 FROM user_season_passes WHERE user_id = $1 AND season_id = $2",
    [userId, seasonId],
  );
  return Boolean(result.rowCount);
}

async function hydrateStoreItems(db: DbClient, record: UserRow): Promise<StoreItemDto[]> {
  const rows = await db.query<StoreItemRow>(
    `SELECT item_id, item_type, display_name, description, currency, price, payload
     FROM store_items
     WHERE active = true
     ORDER BY sort_order, item_id`,
  );
  const entitlements = normalizeEntitlements(record.entitlements);
  const ownedCosmetics = await ownedCosmeticIds(db, record.user_id);
  const current = await getActiveSeason(db);
  const visibleRows = rows.rows.filter((row) => {
    if (row.item_type !== "SEASON_PASS") return true;
    const seasonId = storePayloadString(row.payload ?? {}, "seasonId");
    return Boolean(seasonId && seasonId === current?.season_id);
  });
  return Promise.all(visibleRows.map(async (row) => {
    const payload = row.payload ?? {};
    const cosmeticId = storePayloadString(payload, "cosmeticId");
    const seasonId = storePayloadString(payload, "seasonId");
    const owned = row.item_type === "COSMETIC"
      ? Boolean(cosmeticId && (ownedCosmetics.has(cosmeticId) || entitlements.allStoreItemsUnlocked))
      : row.item_type === "SEASON_PASS"
        ? Boolean(seasonId && await hasSeasonPass(db, record.user_id, seasonId, record.entitlements))
        : false;
    return {
      itemId: row.item_id,
      itemType: row.item_type,
      displayName: row.display_name,
      description: row.description,
      currency: row.currency,
      price: Number(row.price),
      payload,
      owned,
    };
  }));
}

async function getStoreItem(db: DbClient, itemId: string): Promise<StoreItemRow | null> {
  const result = await db.query<StoreItemRow>(
    `SELECT item_id, item_type, display_name, description, currency, price, payload
     FROM store_items
     WHERE item_id = $1 AND active = true`,
    [itemId],
  );
  return result.rows[0] ?? null;
}

async function storeStatePayload(
  db: DbClient,
  user: UserRow,
  extra: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const fresh = await getUser(db, user.user_id) ?? user;
  return {
    ok: true,
    ...extra,
    profile: await toProfile(db, fresh),
    balances: currencyBalancesFor(fresh),
    items: await hydrateStoreItems(db, fresh),
    cosmetics: await hydrateCosmetics(db, fresh),
  };
}

async function grantStoreItem(client: DbClient, user: UserRow, item: StoreItemRow): Promise<void> {
  if (item.item_type === "POWERUP_CHARGE") {
    const charges = clamp(Number(item.payload?.charges ?? 0), 1, 99);
    const stats = await getStats(client, "USER", user.user_id);
    await putStats(client, "USER", user.user_id, user.username, {
      ...stats,
      powerUpCharges: stats.powerUpCharges + charges,
    }, null);
    return;
  }

  if (item.item_type === "COSMETIC") {
    const cosmeticId = storePayloadString(item.payload, "cosmeticId");
    if (!cosmeticId) throw new Error(`store item ${item.item_id} missing cosmeticId`);
    await grantCosmetic(client, user.user_id, cosmeticId, "store");
    return;
  }

  if (item.item_type === "SEASON_PASS") {
    const seasonId = storePayloadString(item.payload, "seasonId");
    if (!seasonId) throw new Error(`store item ${item.item_id} missing seasonId`);
    await client.query(
      `INSERT INTO user_season_passes(user_id, season_id, acquired_at, source)
       VALUES ($1, $2, $3, 'store')
       ON CONFLICT (user_id, season_id) DO NOTHING`,
      [user.user_id, seasonId, Date.now()],
    );
  }
}

async function hydrateCosmetics(db: DbClient, record: UserRow): Promise<CosmeticItemDto[]> {
  const rows = await db.query<CosmeticItemRow>(
    `SELECT c.cosmetic_id, c.cosmetic_type, c.display_name, c.rarity, c.payload,
            pc.cosmetic_id IS NOT NULL AS owned,
            ec.cosmetic_id IS NOT NULL AS equipped
     FROM cosmetic_items c
     LEFT JOIN player_cosmetics pc ON pc.user_id = $1 AND pc.cosmetic_id = c.cosmetic_id
     LEFT JOIN equipped_cosmetics ec ON ec.user_id = $1 AND ec.cosmetic_id = c.cosmetic_id
     WHERE c.active = true
     ORDER BY c.sort_order, c.cosmetic_id`,
    [record.user_id],
  );
  const unlockAll = normalizeEntitlements(record.entitlements).allStoreItemsUnlocked;
  return rows.rows.map((row) => ({
    cosmeticId: row.cosmetic_id,
    cosmeticType: row.cosmetic_type,
    displayName: row.display_name,
    rarity: row.rarity,
    payload: row.payload ?? {},
    owned: unlockAll || row.owned === true,
    equipped: row.equipped === true,
  }));
}

async function equippedMatchAppearance(db: DbClient, userId: string): Promise<MatchAppearance> {
  const rows = await db.query<{
    cosmetic_type: CosmeticItemDto["cosmeticType"];
    cosmetic_id: string;
    display_name: string;
  }>(
    `SELECT c.cosmetic_type, c.cosmetic_id, c.display_name
     FROM equipped_cosmetics ec
     JOIN cosmetic_items c ON c.cosmetic_id = ec.cosmetic_id
     WHERE ec.user_id = $1 AND c.active = true`,
    [userId],
  );

  const appearance: MatchAppearance = {
    avatarFrame: null,
    banner: null,
    title: null,
    badge: null,
  };
  for (const row of rows.rows) {
    const item = { cosmeticId: row.cosmetic_id, displayName: row.display_name };
    if (row.cosmetic_type === "avatar_frame") appearance.avatarFrame = item;
    else if (row.cosmetic_type === "banner") appearance.banner = item;
    else if (row.cosmetic_type === "title") appearance.title = item;
    else if (row.cosmetic_type === "badge") appearance.badge = item;
  }
  return appearance;
}

async function getCosmeticItem(db: DbClient, cosmeticId: string): Promise<CosmeticItemRow | null> {
  const result = await db.query<CosmeticItemRow>(
    `SELECT cosmetic_id, cosmetic_type, display_name, rarity, payload
     FROM cosmetic_items
     WHERE cosmetic_id = $1 AND active = true`,
    [cosmeticId],
  );
  return result.rows[0] ?? null;
}

async function ownedCosmeticIds(db: DbClient, userId: string): Promise<Set<string>> {
  const rows = await db.query<{ cosmetic_id: string }>(
    "SELECT cosmetic_id FROM player_cosmetics WHERE user_id = $1",
    [userId],
  );
  return new Set(rows.rows.map((row) => row.cosmetic_id));
}

async function ownsCosmetic(db: DbClient, userId: string, cosmeticId: string): Promise<boolean> {
  const result = await db.query(
    "SELECT 1 FROM player_cosmetics WHERE user_id = $1 AND cosmetic_id = $2",
    [userId, cosmeticId],
  );
  return result.rowCount !== 0;
}

async function grantCosmetic(db: DbClient, userId: string, cosmeticId: string, source: string): Promise<void> {
  await db.query(
    `INSERT INTO player_cosmetics(user_id, cosmetic_id, source, acquired_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [userId, cosmeticId, source, Date.now()],
  );
}

async function adjustCurrency(
  client: DbClient,
  user: UserRow,
  currency: CurrencyKind,
  delta: number,
  reason: string,
  referenceId: string,
): Promise<{ ok: true; balances: VirtualCurrencyBalances } | { ok: false; balances: VirtualCurrencyBalances }> {
  const current = normalizeCurrencyBalances(user.currency_balances);
  const next = { ...current, [currency]: current[currency] + delta };
  if (next[currency] < 0) return { ok: false, balances: current };
  await client.query(
    "UPDATE users SET currency_balances = $2 WHERE user_id = $1",
    [user.user_id, JSON.stringify(next)],
  );
  await client.query(
    `INSERT INTO currency_ledger(ledger_id, user_id, currency, delta, balance_after, reason, reference_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT DO NOTHING`,
    [`cl-${crypto.randomUUID()}`, user.user_id, currency, delta, next[currency], reason, referenceId, Date.now()],
  );
  return { ok: true, balances: next };
}

function storePayloadString(payload: Record<string, unknown> | null, key: string): string | null {
  const value = payload?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function ensureGooglePlayReviewAccount(): Promise<UserRow | null> {
  const email = (process.env.GOOGLE_PLAY_REVIEW_EMAIL ?? GOOGLE_PLAY_REVIEW_EMAIL).trim().toLowerCase();
  const username = (process.env.GOOGLE_PLAY_REVIEW_USERNAME ?? GOOGLE_PLAY_REVIEW_USERNAME).trim();
  const password = explicitReviewPassword();
  if (!password) {
    console.warn("GOOGLE_PLAY_REVIEW_PASSWORD is not set; reviewer account provisioning skipped.");
    return null;
  }
  const passwordHash = await hashPassword(password);
  const entitlements = reviewAccountEntitlements();
  const currencyBalances = reviewAccountCurrencyBalances();
  const now = Date.now();

  return await tx(async (client) => {
    const existing = await findUserByIdentifier(client, email);
    if (existing) {
      const stats = applyReviewAccountAccess(await getStats(client, "USER", existing.user_id));
      await client.query(
        `UPDATE users
         SET role = $2, entitlements = $3, currency_balances = $4,
             password_hash = $5, last_login_at = GREATEST(last_login_at, $6)
         WHERE user_id = $1`,
        [
          existing.user_id,
          GOOGLE_PLAY_REVIEW_ROLE,
          JSON.stringify(entitlements),
          JSON.stringify(currencyBalances),
          passwordHash,
          now,
        ],
      );
      await putStats(client, "USER", existing.user_id, existing.username, stats, null);
      await syncLeaderboard(client, "USER", existing.user_id, existing.username, stats, null);
      return {
        ...existing,
        role: GOOGLE_PLAY_REVIEW_ROLE,
        entitlements,
        currency_balances: currencyBalances,
        password_hash: passwordHash,
        last_login_at: Math.max(Number(existing.last_login_at), now),
      };
    }

    const selected = await availableReviewUsername(client, username);
    const userId = `u-${crypto.randomUUID()}`;
    await client.query(
      `INSERT INTO users(user_id, username, username_lower, email, password_hash, role, entitlements, currency_balances, created_at, last_login_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`,
      [
        userId,
        selected.username,
        selected.usernameLower,
        email,
        passwordHash,
        GOOGLE_PLAY_REVIEW_ROLE,
        JSON.stringify(entitlements),
        JSON.stringify(currencyBalances),
        now,
      ],
    );
    const stats = applyReviewAccountAccess(emptyStats());
    await putStats(client, "USER", userId, selected.username, stats, null);
    await syncLeaderboard(client, "USER", userId, selected.username, stats, null);
    return {
      user_id: userId,
      username: selected.username,
      username_lower: selected.usernameLower,
      email,
      password_hash: passwordHash,
      role: GOOGLE_PLAY_REVIEW_ROLE,
      entitlements,
      currency_balances: currencyBalances,
      created_at: now,
      last_login_at: now,
    };
  });
}

async function availableReviewUsername(db: DbClient, preferredUsername: string): Promise<{ username: string; usernameLower: string }> {
  for (const username of [preferredUsername, "play_reviewer"]) {
    const usernameLower = username.toLowerCase();
    const existing = await db.query<{ user_id: string }>("SELECT user_id FROM users WHERE username_lower = $1", [usernameLower]);
    if (!existing.rows[0]) return { username, usernameLower };
  }
  const username = `review_${crypto.randomUUID().slice(0, 8)}`;
  return { username, usernameLower: username.toLowerCase() };
}

function isReviewAccountIdentifier(identifier: string): boolean {
  const normalized = identifier.trim().toLowerCase();
  return normalized === (process.env.GOOGLE_PLAY_REVIEW_EMAIL ?? GOOGLE_PLAY_REVIEW_EMAIL).toLowerCase()
    || normalized === (process.env.GOOGLE_PLAY_REVIEW_USERNAME ?? GOOGLE_PLAY_REVIEW_USERNAME).toLowerCase();
}

function userRole(record: UserRow): UserRole {
  return record.role === GOOGLE_PLAY_REVIEW_ROLE ? GOOGLE_PLAY_REVIEW_ROLE : "player";
}

function currencyBalancesFor(record: UserRow): VirtualCurrencyBalances {
  return normalizeEntitlements(record.entitlements).unlimitedCurrency
    ? reviewAccountCurrencyBalances()
    : normalizeCurrencyBalances(record.currency_balances);
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

function toGuestDto(row: GuestRow, stats: PlayerStats, guestSecret?: string): GuestSessionDto {
  return {
    kind: "GUEST",
    guestId: row.guest_id,
    ...(guestSecret ? { guestSecret } : {}),
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

async function claimGuestInTx(client: DbClient, guestId: string | null, guestSecret: string | null): Promise<PlayerStats | null> {
  if (!guestId || !guestSecret) return null;
  const guest = await getGuest(client, guestId, true);
  if (!guest || Number(guest.expires_at) <= Date.now()) return null;
  if (!validGuestSecret(guest, guestSecret)) return null;
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
    console.info("Password reset email not configured; reset token suppressed", record.user_id);
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
  const provided = request.headers["x-internal-token"];
  if (typeof provided !== "string") return false;
  return constantTimeSecretEqual(provided, expected);
}

export function constantTimeSecretEqual(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

function bearer(request: http.IncomingMessage): string | null {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  return token || null;
}

function headerValue(request: http.IncomingMessage, name: string): string {
  const raw = request.headers[name];
  return typeof raw === "string" ? raw.trim() : "";
}

async function rateLimited(
  request: http.IncomingMessage,
  action: string,
  next: () => Promise<ApiResponse>,
  max = AUTH_RATE_LIMIT_MAX,
  windowMs = AUTH_RATE_LIMIT_WINDOW_MS,
): Promise<ApiResponse> {
  const key = `${action}:${clientAddress(request)}`;
  const now = Date.now();
  const resetAt = now + windowMs;
  const result = await pool.query<{ count: number; reset_at: string | number }>(
    `INSERT INTO auth_rate_limits(rate_key, count, reset_at, updated_at)
     VALUES ($1, 1, $2, $3)
     ON CONFLICT (rate_key)
     DO UPDATE SET
       count = CASE
         WHEN auth_rate_limits.reset_at <= $3 THEN 1
         ELSE auth_rate_limits.count + 1
       END,
       reset_at = CASE
         WHEN auth_rate_limits.reset_at <= $3 THEN $2
         ELSE auth_rate_limits.reset_at
       END,
       updated_at = $3
     RETURNING count, reset_at`,
    [key, resetAt, now],
  );
  const row = result.rows[0];
  if (row && Number(row.count) > max) {
    return [429, { error: "rate_limited", message: "Too many attempts. Try again later." }];
  }
  if (Math.random() < 0.01) {
    await pool.query("DELETE FROM auth_rate_limits WHERE reset_at <= $1", [now]).catch(() => undefined);
  }
  return next();
}

function clientAddress(request: http.IncomingMessage): string {
  const forwarded = process.env.TRUST_PROXY === "true" ? request.headers["x-forwarded-for"] : undefined;
  if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0]!.trim();
  return request.socket.remoteAddress ?? "unknown";
}

async function safeJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > MAX_JSON_BODY_BYTES) {
      throw Object.assign(new Error("request body too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function mintGuestSecret(): string {
  return `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "")}`;
}

function validGuestSecret(guest: GuestRow, guestSecret: string | null): boolean {
  if (!guestSecret || !guest.guest_secret_digest) return false;
  return sha256Hex(guestSecret) === guest.guest_secret_digest;
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
  return raw.replace(/[\u0000-\u001F\u007F]/g, "").trim().slice(0, MAX_GUEST_NAME_LENGTH);
}

function isLegacyAutoGuestDisplayName(displayName: string): boolean {
  return /^Player\d+$/i.test(displayName.trim());
}

export async function availableGuestDisplayName(
  db: DbClient,
  preferredName: string,
  excludeGuestId: string | null = null,
): Promise<string> {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('guest-display-names'))");
  const base = preferredName || DEFAULT_GUEST_NAME_BASE;
  const seed = preferredName ? base : `${DEFAULT_GUEST_NAME_BASE}00`;
  const start = preferredName ? 0 : 1;

  for (let offset = 0; offset < 100_000; offset += 1) {
    const candidate = incrementGuestName(seed, start + offset);
    if (!await guestDisplayNameTaken(db, candidate, excludeGuestId)) return candidate;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `${DEFAULT_GUEST_NAME_BASE}${crypto.randomUUID().slice(0, 6)}`.slice(0, MAX_GUEST_NAME_LENGTH);
    if (!await guestDisplayNameTaken(db, candidate, excludeGuestId)) return candidate;
  }

  throw new Error("unable to allocate a unique guest display name");
}

async function guestDisplayNameTaken(db: DbClient, candidate: string, excludeGuestId: string | null): Promise<boolean> {
  const existing = await db.query(
    `SELECT 1 FROM guests
     WHERE expires_at > $1
       AND lower(display_name) = lower($2)
       AND ($3::text IS NULL OR guest_id <> $3)
     LIMIT 1`,
    [Date.now(), candidate, excludeGuestId],
  );
  return existing.rowCount !== 0;
}

export function incrementGuestName(base: string, increment: number): string {
  if (increment <= 0) return base.slice(0, MAX_GUEST_NAME_LENGTH);
  const match = base.match(/^(.*?)(\d+)$/);
  const suffix = match
    ? String(Number.parseInt(match[2]!, 10) + increment).padStart(match[2]!.length, "0")
    : String(increment).padStart(2, "0");
  const prefix = (match?.[1] ?? base).slice(0, Math.max(0, MAX_GUEST_NAME_LENGTH - suffix.length));
  return `${prefix}${suffix}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function resetLink(base: string | undefined, token: string): string {
  const root = (base?.trim() || "quizroyale://reset-password").replace(/[?&]token=$/, "");
  return `${root}${root.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`;
}

function isMainModule(): boolean {
  return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href;
}
