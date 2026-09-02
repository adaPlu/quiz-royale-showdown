import type { GameMode, MatchAppearance } from "./protocol";

export type MatchRoomIdentity = {
  kind: "USER" | "GUEST";
  subjectId: string;
  displayName: string;
  powerUpCharges: number;
  appearance?: MatchAppearance | null;
};

export function buildMatchRoomTargetUrl(
  sourceUrl: string,
  roomId: string,
  mode: GameMode,
  identity: MatchRoomIdentity,
): string {
  const target = new URL(sourceUrl);
  target.pathname = `/room/${encodeURIComponent(roomId)}`;
  target.search = "";
  target.searchParams.set("playerId", identity.subjectId);
  target.searchParams.set("name", identity.displayName);
  target.searchParams.set("kind", identity.kind);
  target.searchParams.set("mode", mode);
  target.searchParams.set("powerUpCharges", String(identity.powerUpCharges));
  if (identity.appearance) {
    target.searchParams.set("appearance", JSON.stringify(identity.appearance));
  }
  return target.toString();
}
