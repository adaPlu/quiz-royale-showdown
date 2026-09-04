export type GameMode = "QUICK" | "TOURNAMENT" | "PRACTICE";
export type MatchDifficulty = "EASY" | "MEDIUM" | "HARD" | "MIXED";
export type MainRoute = "home" | "play" | "store" | "season" | "profile";
export type PowerUp = "FIFTY_FIFTY" | "SHIELD" | "DOUBLE_DOWN";

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

export type VirtualCurrencyBalances = {
  coins: number;
  gems: number;
  seasonalTickets: number;
};

export type Friend = {
  userId: string;
  username: string;
  totalPoints: number;
  wins: number;
  addedAt: number;
  presence: "OFFLINE" | "ONLINE" | "IN_MATCH" | string;
  matchMode?: string | null;
  lastSeenAt: number;
};

export type FriendInvite = {
  inviteId: string;
  direction: string;
  status: string;
  userId: string;
  username: string;
  createdAt: number;
  respondedAt?: number | null;
};

export type FriendInvitesEnvelope = { incoming: FriendInvite[]; outgoing: FriendInvite[] };
export type UserSearchResult = { userId: string; username: string };

export type UserProfile = {
  userId: string;
  username: string;
  email: string;
  role: string;
  currencyBalances: VirtualCurrencyBalances;
  createdAt: number;
  stats: PlayerStats;
  friends: Friend[];
};

export type GuestSession = {
  guestId: string;
  guestSecret?: string | null;
  displayName: string;
  expiresAt: number;
  stats: PlayerStats;
};

export type AuthResult = {
  token: string;
  expiresAt: number;
  profile: UserProfile;
  transferredFromGuest?: boolean;
};

export type Identity =
  | { kind: "guest"; guest: GuestSession }
  | { kind: "user"; token: string; profile: UserProfile };

export type StoreItem = {
  itemId: string;
  itemType: string;
  displayName: string;
  description: string;
  currency: string;
  price: number;
  payload: Record<string, unknown>;
  owned: boolean;
};

export type StoreItemsEnvelope = { balances: VirtualCurrencyBalances; items: StoreItem[] };

export type CosmeticItem = {
  cosmeticId: string;
  cosmeticType: string;
  displayName: string;
  rarity: string;
  payload: Record<string, unknown>;
  owned: boolean;
  equipped: boolean;
};

export type CosmeticsEnvelope = { cosmetics: CosmeticItem[] };

export type Season = {
  seasonId: string;
  name: string;
  startsAt: number;
  endsAt: number;
  rewardTrack: Record<string, unknown>[];
};

export type SeasonProgress = {
  seasonId: string;
  xp: number;
  level: number;
  ticketsEarned: number;
  updatedAt: number;
};

export type CurrentSeasonEnvelope = { season: Season; progress: SeasonProgress; hasSeasonPass?: boolean };

export type LeaderboardEntry = {
  rank: number;
  subjectKind: string;
  subjectId: string;
  displayName: string;
  points: number;
  wins: number;
  isYou?: boolean;
};

export type LeaderboardPage = {
  board: string;
  entries: LeaderboardEntry[];
  yourRank?: number | null;
  yourPoints: number;
  totalRanked: number;
};

export type MatchmakeResponse = {
  roomId: string;
  roomTicket: string;
  mode: GameMode;
  playersWaiting: number;
  lobbyEndsAt: number;
};

export type PrivateMatchResponse = MatchmakeResponse & {
  code: string;
  difficulty: MatchDifficulty;
  createdAt: number;
  updatedAt: number;
};

export type PublicQuestion = {
  id: string;
  category: string;
  difficulty: string;
  text: string;
  options: string[];
};

export type MatchAppearanceCosmetic = { cosmeticId: string; displayName: string };
export type MatchAppearance = {
  avatarFrame?: MatchAppearanceCosmetic | null;
  banner?: MatchAppearanceCosmetic | null;
  title?: MatchAppearanceCosmetic | null;
  badge?: MatchAppearanceCosmetic | null;
};

export type PublicPlayer = {
  id: string;
  name: string;
  isBot: boolean;
  alive: boolean;
  score: number;
  streak: number;
  lives: number;
  hasAnswered: boolean;
  lastAnswerCorrect?: boolean | null;
  placement?: number | null;
  appearance?: MatchAppearance | null;
};

export type PublicMatch = {
  matchId: string;
  mode: GameMode;
  phase: "LOBBY" | "QUESTION" | "REVEAL" | "FINISHED";
  roundNumber: number;
  totalRounds: number;
  phaseEndsAt: number;
  serverNow: number;
  question?: PublicQuestion | null;
  correctIndex?: number | null;
  players: PublicPlayer[];
  aliveCount: number;
  totalPlayers: number;
  winnerId?: string | null;
};

export type YouState = {
  playerId: string;
  alive: boolean;
  score: number;
  streak: number;
  lives: number;
  placement?: number | null;
  answerIndex?: number | null;
  removedOptions: number[];
  availablePowerUps: PowerUp[];
  shieldActive: boolean;
  doubleActive: boolean;
};

export type ServerMessage =
  | { type: "STATE"; match: PublicMatch; you: YouState }
  | { type: "ERROR"; code: string; message: string }
  | { type: "PONG"; serverNow: number };
