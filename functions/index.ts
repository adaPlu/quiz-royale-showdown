// functions/index.ts — Quiz Royale Showdown backend entrypoint.

export { MatchRoom } from "./match-room";
export { Matchmaker } from "./matchmaker";
export { UserDirectory } from "./user-directory";
export { GuestRegistry } from "./guest-registry";
export { Leaderboard } from "./leaderboard";

import {
  dispatchDurableObject,
  GUEST_REGISTRY_ID,
  LEADERBOARD_ID,
  USER_DIRECTORY_ID,
  type DoClassName,
  type DoEnv,
} from "./do-dispatch";
import type { GameMode } from "./protocol";
import type { GuestSessionDto, SubjectKind } from "./identity";
import { callRailwayJson } from "./railway-api";
import { buildMatchRoomTargetUrl } from "./match-routing";
import { allowedBrowserOrigins, isBrowserOriginAllowed, type CorsConfig } from "./cors-policy";
import {
  mintRoomTicket,
  mintSocketTicket,
  verifyRoomTicket,
  verifySocketTicket,
} from "./room-ticket";

type Env = DoEnv & CorsConfig;

const CORS_METHODS = "GET, POST, OPTIONS";
const CORS_HEADERS = "Content-Type, Authorization, X-Guest-Id, X-Guest-Secret";

const HTTP_ROUTES: { pattern: RegExp; className: DoClassName; instance: string; methods: string[] }[] = [
  { pattern: /^\/auth\/(register|login|logout|forgot-password|reset-password)$/, className: "UserDirectory", instance: USER_DIRECTORY_ID, methods: ["POST"] },
  { pattern: /^\/auth\/me$/, className: "UserDirectory", instance: USER_DIRECTORY_ID, methods: ["GET"] },
  { pattern: /^\/users\/search$/, className: "UserDirectory", instance: USER_DIRECTORY_ID, methods: ["GET"] },
  { pattern: /^\/friends\/(add|remove)$/, className: "UserDirectory", instance: USER_DIRECTORY_ID, methods: ["POST"] },
  { pattern: /^\/friends$/, className: "UserDirectory", instance: USER_DIRECTORY_ID, methods: ["GET"] },
  { pattern: /^\/presence\/ping$/, className: "UserDirectory", instance: USER_DIRECTORY_ID, methods: ["POST"] },
  { pattern: /^\/guest\/(session|heartbeat|end)$/, className: "GuestRegistry", instance: GUEST_REGISTRY_ID, methods: ["POST"] },
  { pattern: /^\/guest\/me$/, className: "GuestRegistry", instance: GUEST_REGISTRY_ID, methods: ["GET"] },
  { pattern: /^\/leaderboard$/, className: "Leaderboard", instance: LEADERBOARD_ID, methods: ["GET"] },
  { pattern: /^\/leaderboard\/boards$/, className: "Leaderboard", instance: LEADERBOARD_ID, methods: ["GET"] },
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin")?.trim() || null;

    // Native Android and server-to-server calls normally have no Origin header.
    // Browser calls must come from an explicit allowlisted origin.
    if (!isBrowserOriginAllowed(origin, env)) {
      return new Response("origin not allowed", { status: 403 });
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    if (url.pathname === "/health") {
      return Response.json(
        {
          ok: true,
          service: "quiz-royale",
          now: Date.now(),
          configuration: {
            railwayApiUrl: Boolean(env.RAILWAY_API_URL?.trim()),
            railwayInternalToken: Boolean(env.RAILWAY_INTERNAL_TOKEN?.trim()),
            matchRoomTicketSecret: Boolean(env.MATCH_ROOM_TICKET_SECRET?.trim()),
            railwayApi: Boolean(env.RAILWAY_API_URL?.trim() && env.RAILWAY_INTERNAL_TOKEN?.trim()),
            matchRoomTickets: Boolean(env.MATCH_ROOM_TICKET_SECRET?.trim() || env.RAILWAY_INTERNAL_TOKEN?.trim()),
          },
        },
        { headers: corsHeaders(request, env) },
      );
    }

    if (url.pathname === "/matchmake" && request.method === "GET") {
      return handleMatchmake(request, env, url);
    }

    if (url.pathname === "/websocket-ticket" && request.method === "POST") {
      return handleWebSocketTicket(request, env);
    }

    const roomMatch = url.pathname.match(/^\/match\/([A-Za-z0-9_-]+)$/);
    if (roomMatch && request.headers.get("Upgrade") === "websocket") {
      return handleMatchSocket(request, env, url, roomMatch[1]!);
    }

    for (const route of HTTP_ROUTES) {
      if (!route.pattern.test(url.pathname)) continue;
      if (!route.methods.includes(request.method)) {
        return withCors(new Response("method not allowed", { status: 405 }), request, env);
      }
      const response = await dispatchToDo(env, route.className, route.instance, request);
      return withCors(response, request, env);
    }

    return new Response("not found", { status: 404, headers: corsHeaders(request, env) });
  },
} satisfies ExportedHandler<Env>;

async function handleMatchmake(request: Request, env: Env, url: URL): Promise<Response> {
  const mode = parseMode(url.searchParams.get("mode"));
  const cors = corsHeaders(request, env);

  const response = await dispatchToDo(env, "Matchmaker", mode, request);
  if (!response.ok) {
    const headers = new Headers(cors);
    headers.set("Content-Type", "application/json");
    return new Response(response.body, { status: response.status, headers });
  }

  const body = (await response.json()) as {
    roomId?: string;
    mode?: GameMode;
    playersWaiting?: number;
    lobbyEndsAt?: number;
  };
  if (!body.roomId) return Response.json({ error: "matchmake_failed" }, { status: 502, headers: cors });

  const roomTicket = await mintRoomTicket(env, body.roomId, parseMode(body.mode ?? mode));
  if (!roomTicket) return Response.json({ error: "match_tickets_unavailable" }, { status: 503, headers: cors });
  return Response.json({ ...body, roomTicket }, { status: response.status, headers: cors });
}

async function handleWebSocketTicket(request: Request, env: Env): Promise<Response> {
  const cors = corsHeaders(request, env);
  let body: { roomId?: unknown; mode?: unknown; roomTicket?: unknown };
  try {
    body = await request.json() as { roomId?: unknown; mode?: unknown; roomTicket?: unknown };
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400, headers: cors });
  }

  const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
  const roomTicket = typeof body.roomTicket === "string" ? body.roomTicket : null;
  const mode = parseMode(typeof body.mode === "string" ? body.mode : null);
  if (!roomId || !roomTicket) {
    return Response.json({ error: "invalid_socket_ticket_request" }, { status: 400, headers: cors });
  }

  // Socket-ticket exchange is an authenticated, relatively expensive path.
  // Reuse the mode Matchmaker Durable Object as a distributed per-IP limiter
  // without touching its lobby bucket.
  const limiterHeaders = new Headers(request.headers);
  limiterHeaders.set("X-Quiz-Rate-Limit-Only", "socket-ticket");
  const limiter = await dispatchToDo(
    env,
    "Matchmaker",
    mode,
    new Request(`https://do.internal/rate-limit?mode=${mode}`, { headers: limiterHeaders }),
  );
  if (limiter.status === 429) {
    const headers = new Headers(cors);
    const retryAfter = limiter.headers.get("Retry-After");
    if (retryAfter) headers.set("Retry-After", retryAfter);
    headers.set("Content-Type", "application/json");
    return new Response(limiter.body, { status: 429, headers });
  }

  if (!(await verifyRoomTicket(env, roomTicket, roomId, mode))) {
    return Response.json({ error: "invalid_match_room_ticket" }, { status: 403, headers: cors });
  }

  const identity = await resolveIdentity(env, request, new URL(request.url));
  if (!identity) return Response.json({ error: "identity_required" }, { status: 401, headers: cors });

  const socketTicket = await mintSocketTicket(env, roomId, mode, identity);
  if (!socketTicket) {
    return Response.json({ error: "socket_tickets_unavailable" }, { status: 503, headers: cors });
  }
  return Response.json({ socketTicket, expiresInMs: 2 * 60 * 1000 }, { headers: cors });
}

type ResolvedIdentity = {
  kind: SubjectKind;
  subjectId: string;
  displayName: string;
  powerUpCharges: number;
};

async function handleMatchSocket(
  request: Request,
  env: Env,
  url: URL,
  roomId: string,
): Promise<Response> {
  const mode = parseMode(url.searchParams.get("mode"));
  const cors = corsHeaders(request, env);
  const ticket = url.searchParams.get("roomTicket");
  if (!(await verifyRoomTicket(env, ticket, roomId, mode))) {
    return new Response("invalid match room ticket", { status: 403, headers: cors });
  }

  const browserTicket = url.searchParams.get("socketTicket");
  const identity = browserTicket
    ? await verifySocketTicket(env, browserTicket, roomId, mode)
    : await resolveIdentity(env, request, url);
  if (!identity) {
    return new Response("unable to establish an identity for this match", { status: 401, headers: cors });
  }

  const target = buildMatchRoomTargetUrl(url.toString(), roomId, mode, identity);
  return dispatchToDo(env, "MatchRoom", roomId, new Request(target, request));
}

async function resolveIdentity(env: Env, request: Request, url: URL): Promise<ResolvedIdentity | null> {
  const token = bearer(request);
  if (token) {
    const railway = await callRailwayJson<{ userId: string; username: string; powerUpCharges: number }>(
      env,
      "/auth/resolve",
      { token },
    );
    if (railway) {
      return {
        kind: "USER",
        subjectId: railway.userId,
        displayName: railway.username,
        powerUpCharges: railway.powerUpCharges,
      };
    }

    const resolved = await dispatchToDo(
      env,
      "UserDirectory",
      USER_DIRECTORY_ID,
      new Request("https://do.internal/auth/resolve", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).catch(() => null);

    if (resolved?.ok) {
      const body = (await resolved.json()) as { userId: string; username: string; powerUpCharges?: number };
      return {
        kind: "USER",
        subjectId: body.userId,
        displayName: body.username,
        powerUpCharges: body.powerUpCharges ?? 0,
      };
    }
  }

  const guestId = request.headers.get("X-Guest-Id")?.trim() ?? "";
  const guestSecret = request.headers.get("X-Guest-Secret")?.trim() ?? "";
  if (guestId) {
    const railway = await callRailwayJson<{ guestId: string; displayName: string; powerUpCharges: number }>(
      env,
      "/internal/guest/resolve",
      { headers: { "X-Guest-Id": guestId, "X-Guest-Secret": guestSecret } },
    );
    if (railway) {
      return {
        kind: "GUEST",
        subjectId: railway.guestId,
        displayName: railway.displayName,
        powerUpCharges: railway.powerUpCharges,
      };
    }

    const resolved = await dispatchToDo(
      env,
      "GuestRegistry",
      GUEST_REGISTRY_ID,
      new Request("https://do.internal/internal/guest/resolve", {
        headers: { "X-Guest-Id": guestId, "X-Guest-Secret": guestSecret },
      }),
    ).catch(() => null);

    if (resolved?.ok) {
      const body = (await resolved.json()) as {
        guestId: string;
        displayName: string;
        powerUpCharges?: number;
      };
      return {
        kind: "GUEST",
        subjectId: body.guestId,
        displayName: body.displayName,
        powerUpCharges: body.powerUpCharges ?? 0,
      };
    }
  }

  const railwayGuest = await callRailwayJson<{ guest: GuestSessionDto }>(
    env,
    "/guest/session",
    {
      method: "POST",
      body: { displayName: url.searchParams.get("name") ?? "" },
    },
  );
  if (railwayGuest) {
    return {
      kind: "GUEST",
      subjectId: railwayGuest.guest.guestId,
      displayName: railwayGuest.guest.displayName,
      powerUpCharges: railwayGuest.guest.stats.powerUpCharges,
    };
  }

  const issued = await dispatchToDo(
    env,
    "GuestRegistry",
    GUEST_REGISTRY_ID,
    new Request("https://do.internal/guest/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: url.searchParams.get("name") ?? "" }),
    }),
  ).catch(() => null);

  if (!issued?.ok) return null;
  const body = (await issued.json()) as { guest: GuestSessionDto };
  return {
    kind: "GUEST",
    subjectId: body.guest.guestId,
    displayName: body.guest.displayName,
    powerUpCharges: body.guest.stats.powerUpCharges,
  };
}

function dispatchToDo(
  env: Env,
  className: DoClassName,
  id: string,
  request: Request,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("X-Rork-DO-Class", className);
  headers.set("X-Rork-DO-Id", id);
  return dispatchDurableObject(
    env,
    className,
    id,
    new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      redirect: request.redirect,
    }),
  );
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": CORS_METHODS,
    "Access-Control-Allow-Headers": CORS_HEADERS,
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin")?.trim() || null;
  if (origin && allowedBrowserOrigins(env).has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function withCors(response: Response, request: Request, env: Env): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(request, env)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function parseMode(raw: string | null): GameMode {
  if (raw === "TOURNAMENT" || raw === "PRACTICE" || raw === "QUICK") return raw;
  return "QUICK";
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}
