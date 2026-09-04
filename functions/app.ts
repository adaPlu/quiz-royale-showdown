export { MatchRoom, Matchmaker, UserDirectory, GuestRegistry, Leaderboard } from "./index";

import worker from "./index";
import { isBrowserOriginAllowed, type CorsConfig } from "./cors-policy";
import { callDo, type DoEnv } from "./do-dispatch";
import { PRIVATE_DIRECTORY_ID } from "./matchmaker";
import { handlePrivateMatchAction, type PrivateMatchAction } from "./private-match-api";
import { callRailwayJson } from "./railway-api";
import { mintRoomTicket } from "./room-ticket";

type Env = DoEnv & CorsConfig;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const action = privateMatchAction(url.pathname);
    if (!action) return worker.fetch(request, env);

    const origin = request.headers.get("Origin")?.trim() || null;
    if (!isBrowserOriginAllowed(origin, env)) return new Response("origin not allowed", { status: 403 });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "POST") return withCors(Response.json({ error: "method_not_allowed" }, { status: 405 }), origin);

    const identity = await resolvePrivateIdentity(env, request);
    if (!identity) return withCors(Response.json({ error: "identity_required" }, { status: 401 }), origin);

    let input: Record<string, unknown>;
    try {
      input = await request.json() as Record<string, unknown>;
    } catch {
      return withCors(Response.json({ error: "invalid_json" }, { status: 400 }), origin);
    }

    const response = await handlePrivateMatchAction(
      action,
      input,
      identity,
      async (path, body) => {
        const upstream = await callDo(env, "Matchmaker", PRIVATE_DIRECTORY_ID, path, { method: "POST", body });
        let payload: Record<string, unknown> = {};
        try {
          payload = await upstream.json() as Record<string, unknown>;
        } catch {
          payload = { error: "private_directory_invalid_response" };
        }
        return { status: upstream.status, body: payload };
      },
      async (roomId, mode) => mintRoomTicket(env, roomId, mode),
    );
    return withCors(response, origin);
  },
} satisfies ExportedHandler<Env>;

function privateMatchAction(pathname: string): PrivateMatchAction | null {
  if (pathname === "/private-match/create") return "create";
  if (pathname === "/private-match/join") return "join";
  if (pathname === "/private-match/update") return "update";
  return null;
}

async function resolvePrivateIdentity(env: Env, request: Request): Promise<{ subjectId: string } | null> {
  const authorization = request.headers.get("Authorization")?.trim() ?? "";
  if (authorization.toLowerCase().startsWith("bearer ")) {
    const token = authorization.slice(7).trim();
    const user = await callRailwayJson<{ userId: string }>(env, "/auth/resolve", { token });
    if (user?.userId) return { subjectId: user.userId };
  }

  const guestId = request.headers.get("X-Guest-Id")?.trim() ?? "";
  const guestSecret = request.headers.get("X-Guest-Secret")?.trim() ?? "";
  if (guestId && guestSecret) {
    const guest = await callRailwayJson<{ guestId: string }>(env, "/internal/guest/resolve", {
      headers: { "X-Guest-Id": guestId, "X-Guest-Secret": guestSecret },
    });
    if (guest?.guestId) return { subjectId: guest.guestId };
  }
  return null;
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Guest-Id, X-Guest-Secret",
    "Vary": "Origin",
  });
  if (origin) headers.set("Access-Control-Allow-Origin", origin);
  return headers;
}

function withCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of corsHeaders(origin)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
