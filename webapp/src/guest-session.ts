import { preserveGuestSecret, RAILWAY_API_URL } from "./api";
import type { GuestSession, Identity } from "./types";

export const GUEST_TTL_MS = 30 * 60 * 1000;
export const GUEST_WARNING_MS = 5 * 60 * 1000;
export const GUEST_CRITICAL_MS = 60 * 1000;
export const GUEST_ACTIVITY_WINDOW_MS = 90 * 1000;

export type GuestExpiryLevel = "safe" | "warning" | "critical" | "lapsed";

export function guestRemainingMs(identity: Identity, now = Date.now()): number | null {
  if (identity.kind !== "guest") return null;
  return Math.max(0, identity.guest.expiresAt - now);
}

export function guestExpiryLevel(remainingMs: number): GuestExpiryLevel {
  if (remainingMs <= 0) return "lapsed";
  if (remainingMs <= GUEST_CRITICAL_MS) return "critical";
  if (remainingMs <= GUEST_WARNING_MS) return "warning";
  return "safe";
}

export function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export async function heartbeatGuest(identity: Identity): Promise<Identity> {
  if (identity.kind !== "guest") return identity;
  const response = await fetch(`${RAILWAY_API_URL}/guest/heartbeat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      guestId: identity.guest.guestId,
      guestSecret: identity.guest.guestSecret ?? "",
    }),
  });
  if (!response.ok) throw new Error("Guest session expired.");
  const body = await response.json() as { guest: GuestSession };
  return {
    kind: "guest",
    guest: preserveGuestSecret(body.guest, identity.guest),
  };
}
