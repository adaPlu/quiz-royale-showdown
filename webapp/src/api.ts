import type {
  AuthResult,
  CurrentSeasonEnvelope,
  GameMode,
  GuestSession,
  Identity,
  MatchmakeResponse,
  ServerMessage,
  StoreItemsEnvelope,
  UserProfile,
} from "./types";

export const RAILWAY_API_URL = (import.meta.env.VITE_RAILWAY_API_URL as string | undefined)?.replace(/\/$/, "")
  ?? "https://railway-api-production-5772.up.railway.app";
export const MATCH_API_URL = (import.meta.env.VITE_FUNCTIONS_URL as string | undefined)?.replace(/\/$/, "")
  ?? "https://quiz-royale-functions.adapluguez.workers.dev";

const TOKEN_KEY = "quizroyale.web.token";
const GUEST_ID_KEY = "quizroyale.web.guestId";
const GUEST_SECRET_KEY = "quizroyale.web.guestSecret";
const GUEST_NAME_KEY = "quizroyale.web.guestName";

type ApiError = { message?: string; fields?: Record<string, string>; error?: string };

async function jsonRequest<T>(url: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(url, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const failure = body as ApiError;
    const firstField = Object.values(failure.fields ?? {})[0];
    throw new Error(firstField ?? failure.message ?? failure.error ?? `Request failed (${response.status})`);
  }
  return body as T;
}

function jsonHeaders(extra: HeadersInit = {}): Headers {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json");
  return headers;
}

function identityHeaders(identity: Identity): HeadersInit {
  if (identity.kind === "user") return { Authorization: `Bearer ${identity.token}` };
  return {
    "X-Guest-Id": identity.guest.guestId,
    "X-Guest-Secret": identity.guest.guestSecret ?? "",
  };
}

function rememberGuest(guest: GuestSession): Identity {
  localStorage.setItem(GUEST_ID_KEY, guest.guestId);
  if (guest.guestSecret) localStorage.setItem(GUEST_SECRET_KEY, guest.guestSecret);
  localStorage.setItem(GUEST_NAME_KEY, guest.displayName);
  return { kind: "guest", guest };
}

function rememberUser(result: AuthResult): Identity {
  sessionStorage.setItem(TOKEN_KEY, result.token);
  return { kind: "user", token: result.token, profile: result.profile };
}

export async function restoreIdentity(): Promise<Identity> {
  const token = sessionStorage.getItem(TOKEN_KEY);
  if (token) {
    try {
      const body = await jsonRequest<{ profile: UserProfile }>(`${RAILWAY_API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      return { kind: "user", token, profile: body.profile };
    } catch {
      sessionStorage.removeItem(TOKEN_KEY);
    }
  }

  const guestId = localStorage.getItem(GUEST_ID_KEY);
  const guestSecret = localStorage.getItem(GUEST_SECRET_KEY);
  if (guestId && guestSecret) {
    try {
      const body = await jsonRequest<{ guest: GuestSession }>(`${RAILWAY_API_URL}/guest/me`, {
        headers: { "X-Guest-Id": guestId, "X-Guest-Secret": guestSecret },
      });
      return rememberGuest(body.guest);
    } catch {
      localStorage.removeItem(GUEST_ID_KEY);
      localStorage.removeItem(GUEST_SECRET_KEY);
    }
  }

  return createGuest(localStorage.getItem(GUEST_NAME_KEY) ?? undefined);
}

export async function createGuest(displayName?: string): Promise<Identity> {
  const guestId = localStorage.getItem(GUEST_ID_KEY);
  const guestSecret = localStorage.getItem(GUEST_SECRET_KEY);
  const body = await jsonRequest<{ guest: GuestSession }>(`${RAILWAY_API_URL}/guest/session`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      ...(guestId && guestSecret ? { guestId, guestSecret } : {}),
      ...(displayName?.trim() ? { displayName: displayName.trim().slice(0, 16) } : {}),
    }),
  });
  return rememberGuest(body.guest);
}

export async function login(identifier: string, password: string): Promise<Identity> {
  const result = await jsonRequest<AuthResult>(`${RAILWAY_API_URL}/auth/login`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ identifier, password }),
  });
  return rememberUser(result);
}

export async function register(username: string, email: string, password: string, identity: Identity): Promise<Identity> {
  const transfer = identity.kind === "guest" && Boolean(identity.guest.guestSecret);
  const result = await jsonRequest<AuthResult>(`${RAILWAY_API_URL}/auth/register`, {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      username,
      email,
      password,
      ...(transfer ? {
        guestId: identity.guest.guestId,
        guestSecret: identity.guest.guestSecret,
        transferStats: true,
      } : {}),
    }),
  });
  localStorage.removeItem(GUEST_ID_KEY);
  localStorage.removeItem(GUEST_SECRET_KEY);
  return rememberUser(result);
}

export async function logout(identity: Identity): Promise<Identity> {
  if (identity.kind === "user") {
    await fetch(`${RAILWAY_API_URL}/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${identity.token}` },
    }).catch(() => undefined);
  }
  sessionStorage.removeItem(TOKEN_KEY);
  return createGuest();
}

export async function refreshIdentity(identity: Identity): Promise<Identity> {
  if (identity.kind === "user") {
    const body = await jsonRequest<{ profile: UserProfile }>(`${RAILWAY_API_URL}/auth/me`, {
      headers: identityHeaders(identity),
    });
    return { ...identity, profile: body.profile };
  }
  const body = await jsonRequest<{ guest: GuestSession }>(`${RAILWAY_API_URL}/guest/me`, {
    headers: identityHeaders(identity),
  });
  return rememberGuest(body.guest);
}

export async function loadStore(identity: Identity): Promise<StoreItemsEnvelope> {
  if (identity.kind !== "user") throw new Error("Register or sign in to use the Store.");
  return jsonRequest(`${RAILWAY_API_URL}/store/items`, { headers: identityHeaders(identity) });
}

export async function purchaseStoreItem(identity: Identity, itemId: string): Promise<StoreItemsEnvelope> {
  if (identity.kind !== "user") throw new Error("Register or sign in to purchase items.");
  const result = await jsonRequest<{ balances: StoreItemsEnvelope["balances"]; items: StoreItemsEnvelope["items"] }>(
    `${RAILWAY_API_URL}/store/purchase`,
    {
      method: "POST",
      headers: jsonHeaders(identityHeaders(identity)),
      body: JSON.stringify({ itemId, idempotencyKey: crypto.randomUUID() }),
    },
  );
  return { balances: result.balances, items: result.items };
}

export async function loadSeason(identity: Identity): Promise<CurrentSeasonEnvelope> {
  if (identity.kind !== "user") throw new Error("Register or sign in to view seasonal progression.");
  return jsonRequest(`${RAILWAY_API_URL}/seasons/current`, { headers: identityHeaders(identity) });
}

export async function findMatch(mode: GameMode): Promise<MatchmakeResponse> {
  return jsonRequest(`${MATCH_API_URL}/matchmake?mode=${encodeURIComponent(mode)}`);
}

export async function exchangeSocketTicket(
  identity: Identity,
  match: MatchmakeResponse,
): Promise<string> {
  const body = await jsonRequest<{ socketTicket: string }>(`${MATCH_API_URL}/websocket-ticket`, {
    method: "POST",
    headers: jsonHeaders(identityHeaders(identity)),
    body: JSON.stringify({ roomId: match.roomId, mode: match.mode, roomTicket: match.roomTicket }),
  });
  return body.socketTicket;
}

export async function openMatchSocket(
  identity: Identity,
  match: MatchmakeResponse,
  onMessage: (message: ServerMessage) => void,
  onClose: () => void,
  onError: (message: string) => void,
): Promise<WebSocket> {
  const socketTicket = await exchangeSocketTicket(identity, match);
  const base = MATCH_API_URL.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  const name = identity.kind === "user" ? identity.profile.username : identity.guest.displayName;
  const query = new URLSearchParams({
    mode: match.mode,
    roomTicket: match.roomTicket,
    socketTicket,
    name,
  });
  const socket = new WebSocket(`${base}/match/${encodeURIComponent(match.roomId)}?${query.toString()}`);
  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({ type: "JOIN_MATCH", name }));
  });
  socket.addEventListener("message", (event) => {
    try {
      onMessage(JSON.parse(String(event.data)) as ServerMessage);
    } catch {
      onError("Received an invalid game-state message.");
    }
  });
  socket.addEventListener("error", () => onError("The arena connection failed."));
  socket.addEventListener("close", onClose);
  return socket;
}
