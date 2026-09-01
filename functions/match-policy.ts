import type { GameMode } from "./protocol";

export function competitiveRewardsForMode(mode: GameMode): boolean {
  return mode !== "PRACTICE";
}
