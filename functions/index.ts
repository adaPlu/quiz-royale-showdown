// functions/index.ts — Quiz Royale Showdown backend entrypoint.
//
// Routes:
//   GET  /health                              liveness probe
//   GET  /matchmake?mode=QUICK                returns { roomId } to connect to
//   WS   /match/<roomId>?playerId&name&mode   the authoritative match socket
//
// Both DO classes MUST be re-exported here or the bundler tree-shakes them
// and the platform fails to materialize the instances.

export { MatchRoom } from "./match-room";
export { Matchmaker } from "./matchmaker";

import { MODE_CONFIG, type GameMode } from "./protocol";

type Env = { DO: Fetcher };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "quiz-royale", now: Date.now() }, { headers: CORS });
    }

    if (url.pathname === "/matchmake" && request.method === "GET") {
      const mode = parseMode(url.searchParams.get("mode"));

      // Practice is solo by definition — no shared lobby, no matchmaker hop.
      if (mode === "PRACTICE") {
        const playerId = url.searchParams.get("playerId") ?? crypto.randomUUID();
        return Response.json(
          {
            roomId: `practice-${playerId}-${Date.now().toString(36)}`,
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

    const roomMatch = url.pathname.match(/^\/match\/([A-Za-z0-9_-]+)$/);
    if (roomMatch && request.headers.get("Upgrade") === "websocket") {
      const roomId = roomMatch[1]!;
      const playerId =
        request.headers.get("X-Rork-User-Id") ?? url.searchParams.get("playerId");
      if (!playerId) {
        return new Response("missing playerId", { status: 400, headers: CORS });
      }
      url.searchParams.set("playerId", playerId);

      // 2-arg form: the 1-arg form silently drops the Upgrade header.
      return dispatchToDo(env, "MatchRoom", roomId, new Request(url.toString(), request));
    }

    return new Response("not found", { status: 404, headers: CORS });
  },
} satisfies ExportedHandler<Env>;

function dispatchToDo(env: Env, className: string, id: string, request: Request): Promise<Response> {
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

function parseMode(raw: string | null): GameMode {
  if (raw === "TOURNAMENT" || raw === "PRACTICE" || raw === "QUICK") return raw;
  return "QUICK";
}
