// functions/protocol.ts — the wire contract between the Android client and
// the server. Both sides mirror these shapes; the server is the sole
// authority for every field here.

export type GameMode = "QUICK" | "TOURNAMENT" | "PRACTICE";

export type Phase = "LOBBY" | "QUESTION" | "REVEAL" | "FINISHED";

export type PowerUp = "FIFTY_FIFTY" | "SHIELD" | "DOUBLE_DOWN";

export const ALL_POWER_UPS: PowerUp[] = ["FIFTY_FIFTY", "SHIELD", "DOUBLE_DOWN"];

export type ModeConfig = {
  lobbyMs: number;
  questionMs: number;
  revealMs: number;
  totalRounds: number;
  lives: number;
  maxPlayers: number;
  botFill: number;
};

export const MODE_CONFIG: Record<GameMode, ModeConfig> = {
  QUICK: {
    lobbyMs: 12_000,
    questionMs: 12_000,
    revealMs: 4_500,
    totalRounds: 12,
    lives: 1,
    maxPlayers: 12,
    botFill: 6,
  },
  TOURNAMENT: {
    lobbyMs: 15_000,
    questionMs: 10_000,
    revealMs: 4_000,
    totalRounds: 15,
    lives: 2,
    maxPlayers: 16,
    botFill: 9,
  },
  PRACTICE: {
    lobbyMs: 2_500,
    questionMs: 18_000,
    revealMs: 5_000,
    totalRounds: 10,
    lives: 9_999,
    maxPlayers: 1,
    botFill: 0,
  },
};

// ---------- Client -> Server ----------

export type ClientMessage =
  | { type: "JOIN_MATCH"; name?: string }
  | { type: "SUBMIT_ANSWER"; questionId: string; answerIndex: number }
  | { type: "USE_POWERUP"; powerUp: PowerUp }
  | { type: "LEAVE_MATCH" }
  | { type: "PING" };

// ---------- Server -> Client ----------

export type PublicQuestion = {
  id: string;
  category: string;
  difficulty: string;
  text: string;
  options: string[];
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
  /** Only populated during REVEAL / FINISHED. */
  lastAnswerCorrect: boolean | null;
  /** 1 = winner. Null while still alive and the match is running. */
  placement: number | null;
};

export type PublicMatch = {
  matchId: string;
  mode: GameMode;
  phase: Phase;
  roundNumber: number;
  totalRounds: number;
  /** Epoch ms when the current phase ends. */
  phaseEndsAt: number;
  /** Server clock, so the client can correct for drift. */
  serverNow: number;
  question: PublicQuestion | null;
  /** Null until the round is revealed — this is what makes cheating impossible. */
  correctIndex: number | null;
  players: PublicPlayer[];
  aliveCount: number;
  totalPlayers: number;
  winnerId: string | null;
};

export type YouState = {
  playerId: string;
  alive: boolean;
  score: number;
  streak: number;
  lives: number;
  placement: number | null;
  answerIndex: number | null;
  /** Option indices hidden by a spent FIFTY_FIFTY this round. */
  removedOptions: number[];
  availablePowerUps: PowerUp[];
  shieldActive: boolean;
  doubleActive: boolean;
};

export type ServerMessage =
  | { type: "STATE"; match: PublicMatch; you: YouState }
  | { type: "ERROR"; code: string; message: string }
  | { type: "PONG"; serverNow: number };
