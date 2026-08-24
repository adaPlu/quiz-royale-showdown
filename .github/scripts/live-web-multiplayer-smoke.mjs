const railway = requiredEnv("RAILWAY_API_URL");
const worker = requiredEnv("MATCH_API_URL");
const origin = requiredEnv("WEB_ORIGIN");

const REQUEST_TIMEOUT_MS = 20_000;
const SOCKET_TIMEOUT_MS = 25_000;

let guest = null;

try {
  const railwayHealth = await request("Railway health", `${railway}/health`, {
    headers: { Origin: origin },
  });
  assertCors(railwayHealth.response, "Railway health");

  const workerHealth = await request("Worker health", `${worker}/health`, {
    headers: { Origin: origin },
  });
  assertCors(workerHealth.response, "Worker health");
  assert(workerHealth.body?.configuration?.railwayApiUrl === true, "Worker is missing RAILWAY_API_URL");
  assert(workerHealth.body?.configuration?.railwayInternalToken === true, "Worker is missing RAILWAY_INTERNAL_TOKEN");
  assert(workerHealth.body?.configuration?.matchRoomTicketSecret === true, "Worker is missing MATCH_ROOM_TICKET_SECRET");
  console.log("health and browser CORS PASS");

  const created = await request(
    "create guest",
    `${railway}/guest/session`,
    {
      method: "POST",
      headers: jsonHeaders({ Origin: origin }),
      body: JSON.stringify({ displayName: `Release${Date.now().toString(36).slice(-6)}` }),
    },
    [200, 201],
  );
  assertCors(created.response, "create guest");
  guest = created.body?.guest;
  assert(guest?.guestId && guest?.guestSecret, "new guest credentials are missing");
  const retainedSecret = guest.guestSecret;

  const reused = await request(
    "reuse guest",
    `${railway}/guest/session`,
    {
      method: "POST",
      headers: jsonHeaders({ Origin: origin }),
      body: JSON.stringify({ guestId: guest.guestId, guestSecret: retainedSecret }),
    },
    [200, 201],
  );
  assertCors(reused.response, "reuse guest");
  guest = { ...guest, ...reused.body?.guest, guestSecret: retainedSecret };
  assert(guest.guestSecret === retainedSecret, "guest secret was not retained after session reuse");

  const refreshed = await request("refresh guest", `${railway}/guest/me`, {
    headers: {
      Origin: origin,
      "X-Guest-Id": guest.guestId,
      "X-Guest-Secret": retainedSecret,
    },
  });
  assertCors(refreshed.response, "refresh guest");
  guest = { ...guest, ...refreshed.body?.guest, guestSecret: retainedSecret };
  assert(guest.guestSecret === retainedSecret, "guest secret was not retained after refresh");

  const heartbeat = await request("heartbeat guest", `${railway}/guest/heartbeat`, {
    method: "POST",
    headers: jsonHeaders({ Origin: origin }),
    body: JSON.stringify({ guestId: guest.guestId, guestSecret: retainedSecret }),
  });
  assertCors(heartbeat.response, "heartbeat guest");
  guest = { ...guest, ...heartbeat.body?.guest, guestSecret: retainedSecret };
  assert(guest.guestSecret === retainedSecret, "guest secret was not retained after heartbeat");
  console.log("guest create -> reuse -> refresh -> heartbeat PASS");

  const matchmake = await request("matchmake", `${worker}/matchmake?mode=PRACTICE`, {
    headers: { Origin: origin },
  });
  assertCors(matchmake.response, "matchmake");
  const assignment = matchmake.body;
  assert(assignment?.roomId && assignment?.roomTicket && assignment?.mode === "PRACTICE", "match assignment is incomplete");

  const socketTicket = await request("exchange socket ticket", `${worker}/websocket-ticket`, {
    method: "POST",
    headers: jsonHeaders({
      Origin: origin,
      "X-Guest-Id": guest.guestId,
      "X-Guest-Secret": guest.guestSecret,
    }),
    body: JSON.stringify({
      roomId: assignment.roomId,
      mode: assignment.mode,
      roomTicket: assignment.roomTicket,
    }),
  });
  assertCors(socketTicket.response, "exchange socket ticket");
  assert(socketTicket.body?.socketTicket, "socket ticket is missing");
  console.log("matchmake -> socket-ticket PASS");

  await expectState({ assignment, socketTicket: socketTicket.body.socketTicket, guest });
  console.log("WebSocket STATE PASS");
} finally {
  if (guest?.guestId && guest?.guestSecret) {
    await fetch(`${railway}/guest/end`, {
      method: "POST",
      headers: jsonHeaders({
        Origin: origin,
        "X-Guest-Id": guest.guestId,
        "X-Guest-Secret": guest.guestSecret,
      }),
      body: "{}",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }).catch(() => undefined);
  }
}

async function expectState({ assignment, socketTicket, guest }) {
  assert(typeof WebSocket === "function", "Node runtime does not expose WebSocket");
  const socketBase = worker.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const query = new URLSearchParams({
    mode: assignment.mode,
    roomTicket: assignment.roomTicket,
    socketTicket,
    name: guest.displayName,
  });
  const url = `${socketBase}/match/${encodeURIComponent(assignment.roomId)}?${query}`;

  await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(1000, "sanity complete"); } catch {}
      if (error) reject(error);
      else resolve();
    };
    const timer = setTimeout(
      () => finish(new Error(`timed out waiting for WebSocket STATE after ${SOCKET_TIMEOUT_MS}ms`)),
      SOCKET_TIMEOUT_MS,
    );

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ type: "JOIN_MATCH", name: guest.displayName }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (message?.type === "ERROR") {
        finish(new Error(`WebSocket error ${message.code ?? "UNKNOWN"}: ${message.message ?? "no message"}`));
        return;
      }
      if (message?.type !== "STATE") return;
      try {
        assert(message.match?.matchId, "STATE is missing match.matchId");
        assert(message.you?.playerId === guest.guestId, "STATE resolved the wrong guest identity");
        finish();
      } catch (error) {
        finish(error);
      }
    });
    socket.addEventListener("error", () => finish(new Error("live WebSocket connection failed")));
  });
}

async function request(label, url, init = {}, accepted = [200]) {
  const response = await fetch(url, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text };
  }
  if (!accepted.includes(response.status)) {
    throw new Error(`${label}: ${init.method ?? "GET"} ${url} -> ${response.status}: ${text.slice(0, 400)}`);
  }
  return { response, body };
}

function assertCors(response, label) {
  const allowed = response.headers.get("access-control-allow-origin");
  assert(allowed === origin, `${label} allowed origin ${allowed ?? "<missing>"}, expected ${origin}`);
}

function jsonHeaders(extra = {}) {
  return { "Content-Type": "application/json", ...extra };
}

function requiredEnv(name) {
  const value = process.env[name]?.replace(/\/$/, "");
  if (!value) throw new Error(`missing ${name}`);
  return value;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}
