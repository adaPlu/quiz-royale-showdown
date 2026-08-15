// functions/identity.ts — the identity and progression contract shared by the
// Worker, the match rooms, the stat stores and the Android client.
//
// The central design rule: a GUEST identity and a USER identity are different
// kinds of thing, not one type with optional fields.
//
//   GUEST — temporary. Lives only while the player is active. Carries exactly
//           the competitive counters needed to place them on a leaderboard, and
//           nothing else: no email, no password, no friends, no permanence.
//   USER  — durable. Everything a guest tracks, plus credentials, a friends
//           graph and stats that survive reinstalls.

export type SubjectKind = "GUEST" | "USER";

/** How long a guest may sit idle before its id is expired and recycled. */
export const GUEST_TTL_MS = 30 * 60 * 1000;

/** How often the registry sweeps for idle guests. */
export const GUEST_SWEEP_MS = 5 * 60 * 1000;

/** Sessions last a month; every authenticated call slides the window forward. */
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The competitive counters. Guests and registered users track the SAME shape —
 * that is what lets one leaderboard rank both — but a guest's copy is session
 * state that dies with the guest, while a user's copy is persisted forever.
 */
export type PlayerStats = {
  wins: number;
  losses: number;
  matchesPlayed: number;
  totalPoints: number;
  bestScore: number;
  /** Lowest (best) finishing position ever reached. Null until a match ends. */
  bestPlacement: number | null;
  correctAnswers: number;
  /** Lifetime count of power-ups actually spent. */
  powerUpsUsed: number;
  /** Unspent power-up charges earned from play. */
  powerUpCharges: number;
  /** Points earned per trivia category, drives the category leaderboards. */
  categoryPoints: Record<string, number>;
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
  };
}

/** What a finished match contributes to one player's record. */
export type MatchOutcome = {
  subjectKind: SubjectKind;
  subjectId: string;
  displayName: string;
  won: boolean;
  placement: number | null;
  score: number;
  correctAnswers: number;
  powerUpsUsed: number;
  categoryPoints: Record<string, number>;
  /**
   * False for Practice runs: they still earn points and category progress, but
   * a solo drill must not inflate a win/loss record.
   */
  recordWinLoss: boolean;
};

/** Folds a finished match into a stat block. Pure, so it is trivially testable. */
export function applyOutcome(stats: PlayerStats, outcome: MatchOutcome): PlayerStats {
  const categoryPoints = { ...stats.categoryPoints };
  for (const [category, points] of Object.entries(outcome.categoryPoints)) {
    categoryPoints[category] = (categoryPoints[category] ?? 0) + points;
  }

  const bestPlacement =
    outcome.placement === null
      ? stats.bestPlacement
      : stats.bestPlacement === null
        ? outcome.placement
        : Math.min(stats.bestPlacement, outcome.placement);

  const counted = outcome.recordWinLoss;
  return {
    wins: stats.wins + (counted && outcome.won ? 1 : 0),
    losses: stats.losses + (counted && !outcome.won ? 1 : 0),
    matchesPlayed: stats.matchesPlayed + 1,
    totalPoints: stats.totalPoints + outcome.score,
    bestScore: Math.max(stats.bestScore, outcome.score),
    bestPlacement,
    correctAnswers: stats.correctAnswers + outcome.correctAnswers,
    powerUpsUsed: stats.powerUpsUsed + outcome.powerUpsUsed,
    // Playing earns a charge, winning earns two; spending is already netted out.
    powerUpCharges: Math.max(
      0,
      stats.powerUpCharges - outcome.powerUpsUsed + (outcome.won ? 2 : 1),
    ),
    categoryPoints,
  };
}

/** Merges two stat blocks. Used for the guest -> registered transfer. */
export function mergeStats(base: PlayerStats, incoming: PlayerStats): PlayerStats {
  const categoryPoints = { ...base.categoryPoints };
  for (const [category, points] of Object.entries(incoming.categoryPoints)) {
    categoryPoints[category] = (categoryPoints[category] ?? 0) + points;
  }

  const placements = [base.bestPlacement, incoming.bestPlacement].filter(
    (p): p is number => p !== null,
  );

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
  };
}

// ------------------------------------------------------------------ wire DTOs

/** A guest identity as handed to the client. Note the absence of email. */
export type GuestSessionDto = {
  kind: "GUEST";
  guestId: string;
  displayName: string;
  /** Epoch ms at which this id expires unless the guest checks in again. */
  expiresAt: number;
  stats: PlayerStats;
};

/** A registered identity as handed to the client. Never includes the hash. */
export type UserProfileDto = {
  kind: "USER";
  userId: string;
  username: string;
  email: string;
  createdAt: number;
  stats: PlayerStats;
  friends: FriendDto[];
};

export type FriendDto = {
  userId: string;
  username: string;
  totalPoints: number;
  wins: number;
  addedAt: number;
};

export type LeaderboardEntryDto = {
  rank: number;
  subjectKind: SubjectKind;
  subjectId: string;
  displayName: string;
  points: number;
  wins: number;
  /** True when this row is the caller, so the client can highlight it. */
  isYou: boolean;
};

export type LeaderboardDto = {
  /** "WORLD" or a category name. */
  board: string;
  entries: LeaderboardEntryDto[];
  /** The caller's position even when outside the returned page. Null if unranked. */
  yourRank: number | null;
  yourPoints: number;
  totalRanked: number;
};

export type AuthResultDto = {
  token: string;
  expiresAt: number;
  profile: UserProfileDto;
  /** Set when guest session stats were folded into this account. */
  transferredFromGuest: boolean;
};
