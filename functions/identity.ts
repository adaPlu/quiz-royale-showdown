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
 * How recently a registered player must have checked in to count as online.
 * Deliberately a little over twice the client's ping interval, so one dropped
 * request does not make a friend flicker to offline.
 */
export const PRESENCE_ONLINE_WINDOW_MS = 100 * 1000;

/**
 * An IN_MATCH claim self-expires: if a client dies mid-match we must not show
 * that player as "in a match" forever. Longer than the longest possible match.
 */
export const PRESENCE_MATCH_WINDOW_MS = 12 * 60 * 1000;

/** What a friend is doing right now, as far as the server can tell. */
export type PresenceStatus = "OFFLINE" | "ONLINE" | "IN_MATCH";
export type UserRole = "player" | "google_play_reviewer";

export const GOOGLE_PLAY_REVIEW_ROLE: UserRole = "google_play_reviewer";
export const GOOGLE_PLAY_REVIEW_EMAIL = "google-reviewer@quizroyale.gg";
export const GOOGLE_PLAY_REVIEW_USERNAME = "google_reviewer";
export const REVIEW_ACCOUNT_BALANCE = 1_000_000_000;

export type UserEntitlements = {
  isReviewer: boolean;
  unlimitedCurrency: boolean;
  allStoreItemsUnlocked: boolean;
  premiumAccess: boolean;
  seasonPassAccess: boolean;
};

export type VirtualCurrencyBalances = {
  coins: number;
  gems: number;
  seasonalTickets: number;
};

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
  /**
   * Best (lowest) world leaderboard rank this subject has ever held, recorded
   * at the moment it was reached. Persisted rather than derived because a
   * milestone must stay earned even after other players overtake you — a badge
   * that silently disappears is worse than no badge.
   */
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

export function reviewAccountEntitlements(): UserEntitlements {
  return {
    isReviewer: true,
    unlimitedCurrency: true,
    allStoreItemsUnlocked: true,
    premiumAccess: true,
    seasonPassAccess: true,
  };
}

export function reviewAccountCurrencyBalances(): VirtualCurrencyBalances {
  return {
    coins: REVIEW_ACCOUNT_BALANCE,
    gems: REVIEW_ACCOUNT_BALANCE,
    seasonalTickets: REVIEW_ACCOUNT_BALANCE,
  };
}

export function normalizeEntitlements(raw: unknown): UserEntitlements {
  const entitlements = typeof raw === "object" && raw !== null ? raw as Partial<UserEntitlements> : {};
  return {
    isReviewer: entitlements.isReviewer === true,
    unlimitedCurrency: entitlements.unlimitedCurrency === true,
    allStoreItemsUnlocked: entitlements.allStoreItemsUnlocked === true,
    premiumAccess: entitlements.premiumAccess === true,
    seasonPassAccess: entitlements.seasonPassAccess === true,
  };
}

export function normalizeCurrencyBalances(raw: unknown): VirtualCurrencyBalances {
  const balances = typeof raw === "object" && raw !== null ? raw as Partial<VirtualCurrencyBalances> : {};
  return {
    coins: normalizeBalance(balances.coins),
    gems: normalizeBalance(balances.gems),
    seasonalTickets: normalizeBalance(balances.seasonalTickets),
  };
}

export function applyReviewAccountAccess(rawStats: PlayerStats): PlayerStats {
  return {
    ...normalizeStats(rawStats),
    powerUpCharges: REVIEW_ACCOUNT_BALANCE,
  };
}

/**
 * Fills in fields absent from records written by an earlier version, so reading
 * old storage never yields `undefined` where the type promises a value.
 */
export function normalizeStats(stats: PlayerStats): PlayerStats {
  return {
    ...emptyStats(),
    ...stats,
    categoryPoints: stats.categoryPoints ?? {},
    bestRank: stats.bestRank ?? null,
  };
}

function normalizeBalance(raw: unknown): number {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** Folds a newly observed leaderboard rank into a stat block, keeping the best. */
export function applyRank(stats: PlayerStats, rank: number | null): PlayerStats {
  if (rank === null || rank <= 0) return stats;
  const current = stats.bestRank;
  if (current !== null && current <= rank) return stats;
  return { ...stats, bestRank: rank };
}

/** What a finished match contributes to one player's record. */
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
  /** False for Practice runs, which must not mutate persistent competitive progression. */
  recordWinLoss: boolean;
  /**
   * Explicit economy/progression gate. Optional for wire compatibility with
   * older match workers; when absent, recordWinLoss is the fallback signal.
   */
  competitiveRewards?: boolean;
};

/** Folds a finished match into a stat block. Pure, so it is trivially testable. */
export function applyOutcome(base: PlayerStats, outcome: MatchOutcome): PlayerStats {
  const stats = normalizeStats(base);
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
  const competitive = outcome.competitiveRewards ?? counted;
  if (!competitive) return stats;

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
    bestRank: stats.bestRank,
  };
}

/** Merges two stat blocks. Used for the guest -> registered transfer. */
export function mergeStats(rawBase: PlayerStats, rawIncoming: PlayerStats): PlayerStats {
  const base = normalizeStats(rawBase);
  const incoming = normalizeStats(rawIncoming);
  const categoryPoints = { ...base.categoryPoints };
  for (const [category, points] of Object.entries(incoming.categoryPoints)) {
    categoryPoints[category] = (categoryPoints[category] ?? 0) + points;
  }

  const placements = [base.bestPlacement, incoming.bestPlacement].filter(
    (p): p is number => p !== null,
  );
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

// ------------------------------------------------------------------ wire DTOs

/** A guest identity as handed to the client. Note the absence of email. */
export type GuestSessionDto = {
  kind: "GUEST";
  guestId: string;
  guestSecret?: string;
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
  role: UserRole;
  entitlements: UserEntitlements;
  currencyBalances: VirtualCurrencyBalances;
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
  /** Live presence, derived server-side from the friend's last check-in. */
  presence: PresenceStatus;
  /** Set only when presence is IN_MATCH, so the UI can name the mode. */
  matchMode: string | null;
  /** Epoch ms of the friend's last check-in. 0 when never seen. */
  lastSeenAt: number;
};

/** What a client reports about itself, and what the room reports on its behalf. */
export type PresenceRecord = {
  lastSeenAt: number;
  status: "IDLE" | "IN_MATCH";
  matchMode: string | null;
  /** When the current status was set, used to expire a stale IN_MATCH claim. */
  statusAt: number;
};

/** Collapses a stored presence record into what friends should see. */
export function derivePresence(
  record: PresenceRecord | null | undefined,
  now = Date.now(),
): { presence: PresenceStatus; matchMode: string | null; lastSeenAt: number } {
  if (!record) return { presence: "OFFLINE", matchMode: null, lastSeenAt: 0 };

  // Being in a match keeps you visible even if the ping loop is paused by the
  // match screen, but only until the claim ages out.
  const inMatch =
    record.status === "IN_MATCH" && now - record.statusAt < PRESENCE_MATCH_WINDOW_MS;
  if (inMatch) {
    return { presence: "IN_MATCH", matchMode: record.matchMode, lastSeenAt: record.lastSeenAt };
  }

  if (now - record.lastSeenAt <= PRESENCE_ONLINE_WINDOW_MS) {
    return { presence: "ONLINE", matchMode: null, lastSeenAt: record.lastSeenAt };
  }
  return { presence: "OFFLINE", matchMode: null, lastSeenAt: record.lastSeenAt };
}

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

export function publicLeaderboardSubjectId(subjectKind: SubjectKind, subjectId: string): string {
  if (subjectKind === "USER") return subjectId;
  return `guest-${subjectId.replace(/^g/, "").split("-")[0] ?? "anon"}`;
}
