// functions/index.ts — Quiz Royale Showdown backend entrypoint.
//
// Routes:
//   GET  /health                              liveness probe
//   GET  /matchmake?mode=QUICK                returns { roomId } to connect to
//   WS   /match/<roomId>?token|guestId&mode   the authoritative match socket
//
//   POST /auth/register                       create a registered account
//   POST /auth/login                          exchange credentials for a token
//   POST /auth/logout                         revoke the current token
//   GET  /auth/me                             the caller's profile + friends
//   GET  /users/search?q=                     find players to befriend
//   POST /friends/add | /friends/remove       mutate the friends graph
//   GET  /friends                             friends + live presence (polled)
//   POST /presence/ping                       "I am still here" check-in
//
//   POST /guest/session                       issue or renew a temporary guest id
//   POST /guest/heartbeat                     keep a guest id alive
//   POST /guest/end                           retire a guest id immediately
//   GET  /guest/me?guestId=                   read a guest's session stats
//
//   GET  /leaderboard?board=WORLD|<category>  ranked board (guests + users)
//   GET  /leaderboard/boards                  the list of available boards
//
//   GET  /legal | /legal/privacy | /legal/terms | /legal/eula
//        Public, unauthenticated legal documents. Play Console and App Store
//        Review both require a reachable privacy policy URL, so these are served
//        from here rather than needing a separate static host.
//
// Presence is deliberately friends-only: /friends is the sole way to read it,
// and it requires a session token, so a player's activity is never public.
//
// Identity is resolved HERE, at the edge, before the match socket reaches the
// room. The room then trusts the `kind` / `playerId` query params because this
// Worker overwrites whatever the client sent. That keeps the anti-cheat boundary
// in exactly one place.
//
// All DO classes MUST be re-exported here or the bundler tree-shakes them and
// the platform fails to materialize the instances.

export { MatchRoom } from "./match-room";
export { Matchmaker } from "./matchmaker";
export { UserDirectory } from "./user-directory";
export { GuestRegistry } from "./guest-registry";
export { Leaderboard } from "./leaderboard";

import {
  GUEST_REGISTRY_ID,
  LEADERBOARD_ID,
  USER_DIRECTORY_ID,
  type DoEnv,
} from "./do-dispatch";
import { MODE_CONFIG, type GameMode } from "./protocol";
import { handleLegal } from "./legal";
import type { GuestSessionDto, SubjectKind } from "./identity";

type Env = DoEnv;

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

/** Path -> DO class routing table for the plain-HTTP endpoints. */
const HTTP_ROUTES: { pattern: RegExp; className: string; instance: string; methods: string[] }[] = [
  { pattern: /^\/auth\/(register|login|logout)$/, className: "UserDirectory", instance: USER_DIRECTORY_ID, methods: ["POST"] },
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

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "quiz-royale", now: Date.now() }, { headers: CORS });
    }

    // Plain public HTML: no auth, no DO hop. Checked before the route table so a
    // store reviewer or crawler never touches the game path.
    if (url.pathname.startsWith("/legal")) {
      const legal = handleLegal(url.pathname);
      if (legal) return legal;
    }

    if (url.pathname === "/matchmake" && request.method === "GET") {
      return await handleMatchmake(request, env, url);
    }

    const roomMatch = url.pathname.match(/^\/match\/([A-Za-z0-9_-]+)$/);
    if (roomMatch && request.headers.get("Upgrade") === "websocket") {
      return await handleMatchSocket(request, env, url, roomMatch[1]!);
    }

    for (const route of HTTP_ROUTES) {
      if (!route.pattern.test(url.pathname)) continue;
      if (!route.methods.includes(request.method)) {
        return withCors(new Response("method not allowed", { status: 405 }));
      }
      const response = await dispatchToDo(env, route.className, route.instance, request);
      return withCors(response);
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
} satisfies ExportedHandler<Env>;

// ------------------------------------------------------------------ matchmake

async function handleMatchmake(request: Request, env: Env, url: URL): Promise<Response> {
  const mode = parseMode(url.searchParams.get("mode"));

  // Practice is solo by definition — no shared lobby, no matchmaker hop.
  if (mode === "PRACTICE") {
    const playerId = url.searchParams.get("playerId") ?? crypto.randomUUID();
    return Response.json(
      {
        roomId: `practice-${sanitizeRoomToken(playerId)}-${Date.now().toString(36)}`,
        mode,
        playersWaiting: 1,
        lobbyEndsAt: Date.now() + MODE_CONFIG.PRACTICE.lobbyMs,
      },
      { headers: CORS },
    );
  }

  const response = await dispatchToDo(env, "Matchmaker", mode, request);
  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// --------------------------------------------------------------- match socket

type ResolvedIdentity = {
  kind: SubjectKind;
  subjectId: string;
  displayName: string;
};

async function handleMatchSocket(
  request: Request,
  env: Env,
  url: URL,
  roomId: string,
): Promise<Response> {
  const identity = await resolveIdentity(env, url);
  if (!identity) {
    return new Response("unable to establish an identity for this match", {
      status: 401,
      headers: CORS,
    });
  }

  // Rebuild the query from scratch so nothing the client sent can leak through
  // into the trusted fields the room reads.
  const target = new URL(url.toString());
  target.search = "";
  target.searchParams.set("playerId", identity.subjectId);
  target.searchParams.set("name", identity.displayName);
  target.searchParams.set("kind", identity.kind);
  target.searchParams.set("mode", parseMode(url.searchParams.get("mode")));

  // 2-arg form: the 1-arg form silently drops the Upgrade header.
  return dispatchToDo(env, "MatchRoom", roomId, new Request(target.toString(), request));
}

/**
 * Turns whatever credential the client presented into a trusted identity.
 *
 * Order matters: a session token always wins over a guest id, so a logged-in
 * player never accidentally banks their match onto a stale guest record. If no
 * usable credential is present we mint a fresh guest rather than refusing —
 * playing without registering must never fail.
 */
async function resolveIdentity(env: Env, url: URL): Promise<ResolvedIdentity | null> {
  const token = url.searchParams.get("token");
  if (token) {
    const resolved = await dispatchToDo(
      env,
      "UserDirectory",
      USER_DIRECTORY_ID,
      new Request("https://do.internal/auth/resolve", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ).catch(() => null);

    if (resolved?.ok) {
      const body = (await resolved.json()) as { userId: string; username: string };
      return { kind: "USER", subjectId: body.userId, displayName: body.username };
    }
    // Token was rejected: fall through to guest so a lapsed session still plays.
  }

  const guestId = url.searchParams.get("guestId");
  if (guestId) {
    const resolved = await dispatchToDo(
      env,
      "GuestRegistry",
      GUEST_REGISTRY_ID,
      new Request(
        `https://do.internal/internal/guest/resolve?guestId=${encodeURIComponent(guestId)}`,
      ),
    ).catch(() => null);

    if (resolved?.ok) {
      const body = (await resolved.json()) as { guestId: string; displayName: string };
      return { kind: "GUEST", subjectId: body.guestId, displayName: body.displayName };
    }
  }

  // Safety net: issue a throwaway guest so the match still starts.
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
  };
}

// --------------------------------------------------------------------- plumbing

function dispatchToDo(
  env: Env,
  className: string,
  id: string,
  request: Request,
): Promise<Response> {
  const headers = new Headers(request.headers);
  headers.set("X-Rork-DO-Class", className);
  headers.set("X-Rork-DO-Id", id);
  return env.DO.fetch(
    new Request(request.url, {
      method: request.method,
      headers,
      body: request.body,
      redirect: request.redirect,
    }),
  );
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value);
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

function sanitizeRoomToken(raw: string): string {
  return raw.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "solo";
}
