export const DEFAULT_GUEST_NAME_BASE = "Challenger";
export const MAX_GUEST_NAME_LENGTH = 16;

export function incrementGuestName(base: string, increment: number): string {
  if (increment <= 0) return base.slice(0, MAX_GUEST_NAME_LENGTH);
  const match = base.match(/^(.*?)(\d+)$/);
  const suffix = match
    ? String(Number.parseInt(match[2]!, 10) + increment).padStart(match[2]!.length, "0")
    : String(increment).padStart(2, "0");
  const prefix = (match?.[1] ?? base).slice(0, Math.max(0, MAX_GUEST_NAME_LENGTH - suffix.length));
  return `${prefix}${suffix}`;
}
