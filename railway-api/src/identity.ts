export type SubjectKind = "GUEST" | "USER";

export const GUEST_TTL_MS = 30 * 60 * 1000;
export const GUEST_SWEEP_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const PRESENCE_ONLINE_WINDOW_MS = 100 * 1000;
export const PRESENCE_MATCH_WINDOW_MS = 12 * 60 * 1000;

export type PresenceStatus = "OFFLINE" | "ONLINE" | "IN_MATCH";

export type PlayerStats = {
  wins: number;
  losses: number;
  matchesPlayed: number;
  totalPoints: number;
  bestScore: number;
  bestPlacement: number | null;
  correctAnswers: number;
  powerUpsUsed: number;
  powerUpCharges: number;
  categoryPoints: Record<string, number>;
  bestRank: number | null;
};

export function emptyStats(): PlayerStats {
  return {
    wins: 0,
    losses: 0,
    matchesPlayed: 0,
    totalPoints: 0,
    bestScore: 0,
    bestPlacement: null,
    correctAnswers: 0,
    powerUpsUsed: 0,
    powerUpCharges: 3,
    categoryPoints: {},
    bestRank: null,
  };
}

export function normalizeStats(raw: unknown): PlayerStats {
  const stats = typeof raw === "object" && raw !== null ? (raw as Partial<PlayerStats>) : {};
  return {
    ...emptyStats(),
    ...stats,
    categoryPoints: stats.categoryPoints ?? {},
    bestRank: stats.bestRank ?? null,
    bestPlacement: stats.bestPlacement ?? null,
  };
}

export function applyRank(rawStats: PlayerStats, rank: number | null): PlayerStats {
  if (rank === null || rank <= 0) return rawStats;
  const stats = normalizeStats(rawStats);
  if (stats.bestRank !== null && stats.bestRank <= rank) return stats;
  return { ...stats, bestRank: rank };
}

export type MatchOutcome = {
  matchId: string;
  subjectKind: SubjectKind;
  subjectId: string;
  displayName: string;
  won: boolean;
  placement: number | null;
  score: number;
  correctAnswers: number;
  powerUpsUsed: number;
  categoryPoints: Record<string, number>;
  recordWinLoss: boolean;
};

export function applyOutcome(rawBase: PlayerStats, outcome: MatchOutcome): PlayerStats {
  const base = normalizeStats(rawBase);
  const categoryPoints = { ...base.categoryPoints };
  for (const [category, points] of Object.entries(outcome.categoryPoints)) {
    categoryPoints[category] = (categoryPoints[category] ?? 0) + points;
  }

  const placements = [base.bestPlacement, outcome.placement].filter((p): p is number => p !== null);
  const counted = outcome.recordWinLoss;

  return {
    wins: base.wins + (counted && outcome.won ? 1 : 0),
    losses: base.losses + (counted && !outcome.won ? 1 : 0),
    matchesPlayed: base.matchesPlayed + 1,
    totalPoints: base.totalPoints + outcome.score,
    bestScore: Math.max(base.bestScore, outcome.score),
    bestPlacement: placements.length > 0 ? Math.min(...placements) : null,
    correctAnswers: base.correctAnswers + outcome.correctAnswers,
    powerUpsUsed: base.powerUpsUsed + outcome.powerUpsUsed,
    powerUpCharges: Math.max(0, base.powerUpCharges - outcome.powerUpsUsed + (outcome.won ? 2 : 1)),
    categoryPoints,
    bestRank: base.bestRank,
  };
}

export function mergeStats(rawBase: PlayerStats, rawIncoming: PlayerStats): PlayerStats {
  const base = normalizeStats(rawBase);
  const incoming = normalizeStats(rawIncoming);
  const categoryPoints = { ...base.categoryPoints };
  for (const [category, points] of Object.entries(incoming.categoryPoints)) {
    categoryPoints[category] = (categoryPoints[category] ?? 0) + points;
  }

  const placements = [base.bestPlacement, incoming.bestPlacement].filter((p): p is number => p !== null);
  const ranks = [base.bestRank, incoming.bestRank].filter((r): r is number => r !== null);

  return {
    wins: base.wins + incoming.wins,
    losses: base.losses + incoming.losses,
    matchesPlayed: base.matchesPlayed + incoming.matchesPlayed,
    totalPoints: base.totalPoints + incoming.totalPoints,
    bestScore: Math.max(base.bestScore, incoming.bestScore),
    bestPlacement: placements.length > 0 ? Math.min(...placements) : null,
    correctAnswers: base.correctAnswers + incoming.correctAnswers,
    powerUpsUsed: base.powerUpsUsed + incoming.powerUpsUsed,
    powerUpCharges: base.powerUpCharges + incoming.powerUpCharges,
    categoryPoints,
    bestRank: ranks.length > 0 ? Math.min(...ranks) : null,
  };
}

export type FriendDto = {
  userId: string;
  username: string;
  totalPoints: number;
  wins: number;
  addedAt: number;
  presence: PresenceStatus;
  matchMode: string | null;
  lastSeenAt: number;
};

export type UserProfileDto = {
  kind: "USER";
  userId: string;
  username: string;
  email: string;
  createdAt: number;
  stats: PlayerStats;
  friends: FriendDto[];
};

export type GuestSessionDto = {
  kind: "GUEST";
  guestId: string;
  displayName: string;
  expiresAt: number;
  stats: PlayerStats;
};

export type AuthResultDto = {
  token: string;
  expiresAt: number;
  profile: UserProfileDto;
  transferredFromGuest: boolean;
};

export type LeaderboardEntryDto = {
  rank: number;
  subjectKind: SubjectKind;
  subjectId: string;
  displayName: string;
  points: number;
  wins: number;
  isYou: boolean;
};

export type LeaderboardDto = {
  board: string;
  entries: LeaderboardEntryDto[];
  yourRank: number | null;
  yourPoints: number;
  totalRanked: number;
};

export type PresenceRecord = {
  lastSeenAt: number;
  status: "IDLE" | "IN_MATCH";
  matchMode: string | null;
  statusAt: number;
};

export function derivePresence(
  record: PresenceRecord | null | undefined,
  now = Date.now(),
): { presence: PresenceStatus; matchMode: string | null; lastSeenAt: number } {
  if (!record) return { presence: "OFFLINE", matchMode: null, lastSeenAt: 0 };
  if (record.status === "IN_MATCH" && now - record.statusAt < PRESENCE_MATCH_WINDOW_MS) {
    return { presence: "IN_MATCH", matchMode: record.matchMode, lastSeenAt: record.lastSeenAt };
  }
  if (now - record.lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS) {
    return { presence: "ONLINE", matchMode: null, lastSeenAt: record.lastSeenAt };
  }
  return { presence: "OFFLINE", matchMode: null, lastSeenAt: record.lastSeenAt };
}
