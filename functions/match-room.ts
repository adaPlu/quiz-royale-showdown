// functions/match-room.ts — one Durable Object instance per match.
//
// This object is the single source of truth for a match: it owns the player
// roster, the question set (with answers the clients never see until reveal),
// the phase clock, scoring, eliminations, and power-up charges. Clients only
// ever send intents (JOIN_MATCH / SUBMIT_ANSWER / USE_POWERUP); every state
// transition is computed here and broadcast back.

import { DurableObject } from "cloudflare:workers";
import { buildQuestionSet, type Question } from "./questions";
import {
  ALL_POWER_UPS,
  MODE_CONFIG,
  type ClientMessage,
  type GameMode,
  type Phase,
  type PowerUp,
  type PublicMatch,
  type PublicPlayer,
  type ServerMessage,
  type YouState,
} from "./protocol";

type Env = {
  DO: Fetcher & {
    setAlarm(className: string, id: string, scheduledTime: number | Date): Promise<void>;
    getAlarm(className: string, id: string): Promise<number | null>;
    deleteAlarm(className: string, id: string): Promise<void>;
  };
};

type PlayerState = {
  id: string;
  name: string;
  isBot: boolean;
  botSkill: number;
  connected: boolean;
  alive: boolean;
  score: number;
  streak: number;
  bestStreak: number;
  correctCount: number;
  lives: number;
  placement: number | null;
  answerIndex: number | null;
  answeredAt: number | null;
  lastAnswerCorrect: boolean | null;
  removedOptions: number[];
  spentPowerUps: PowerUp[];
  shieldActive: boolean;
  doubleActive: boolean;
};

type MatchState = {
  matchId: string;
  mode: GameMode;
  phase: Phase;
  roundNumber: number;
  phaseEndsAt: number;
  /** Wall clock when the current QUESTION phase opened. Never rewritten by an
   * early round end, so speed bonuses stay accurate. */
  questionStartedAt: number;
  questions: Question[];
  players: Record<string, PlayerState>;
  order: string[];
  winnerId: string | null;
  botsSpawned: boolean;
};

const BOT_NAMES = [
  "Nova", "Vex", "Quill", "Rune", "Zephyr", "Onyx", "Sable", "Kite",
  "Marlow", "Juno", "Cinder", "Vega", "Bram", "Wren", "Ozzy", "Lyra",
];

const STATE_KEY = "match-state";

export class MatchRoom extends DurableObject<Env> {
  private state: MatchState | null = null;
  private phaseTimer: ReturnType<typeof setTimeout> | null = null;
  private botTimers: ReturnType<typeof setTimeout>[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.blockConcurrencyWhile(async () => {
      this.state = (await this.ctx.storage.get<MatchState>(STATE_KEY)) ?? null;
    });
  }

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }

    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId");
    if (!playerId) return new Response("missing playerId", { status: 400 });

    const name = sanitizeName(url.searchParams.get("name"));
    const mode = parseMode(url.searchParams.get("mode"));

    const state = this.ensureState(mode);

    // Late joiners become spectators rather than being rejected outright —
    // they still see the match play out and can rematch from the results screen.
    const existing = state.players[playerId];
    if (existing) {
      existing.connected = true;
      existing.name = name || existing.name;
    } else if (state.phase === "LOBBY" && humanCount(state) < MODE_CONFIG[state.mode].maxPlayers) {
      state.players[playerId] = newPlayer(playerId, name, false, MODE_CONFIG[state.mode].lives);
      state.order.push(playerId);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ playerId });

    this.persist();
    // Return the 101 first; fan-out and timer arming happen right after.
    this.sendTo(server, playerId);
    this.broadcast();
    this.armPhaseTimer();

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== "string") return;

    const attachment = ws.deserializeAttachment() as { playerId: string } | null;
    if (!attachment?.playerId) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw) as ClientMessage;
    } catch {
      this.sendError(ws, "BAD_JSON", "Message was not valid JSON.");
      return;
    }

    // In-memory timers do not survive hibernation — re-arm on every inbound
    // message so a woken room always has a live phase clock.
    this.armPhaseTimer();

    switch (msg.type) {
      case "PING":
        safeSend(ws, { type: "PONG", serverNow: Date.now() });
        return;
      case "JOIN_MATCH":
        this.sendTo(ws, attachment.playerId);
        return;
      case "SUBMIT_ANSWER":
        this.handleAnswer(ws, attachment.playerId, msg.questionId, msg.answerIndex);
        return;
      case "USE_POWERUP":
        this.handlePowerUp(ws, attachment.playerId, msg.powerUp);
        return;
      case "LEAVE_MATCH":
        this.handleLeave(attachment.playerId);
        return;
      default:
        this.sendError(ws, "UNKNOWN_TYPE", "Unrecognised message type.");
    }
  }

  override webSocketClose(ws: WebSocket): void {
    const attachment = ws.deserializeAttachment() as { playerId: string } | null;
    const state = this.state;
    if (!attachment?.playerId || !state) return;

    const player = state.players[attachment.playerId];
    if (player) player.connected = false;

    // A player who drops during the lobby leaves no ghost behind.
    if (state.phase === "LOBBY" && player && !player.isBot) {
      delete state.players[attachment.playerId];
      state.order = state.order.filter((id) => id !== attachment.playerId);
    }
    this.persist();
    this.broadcast();
  }

  /** Durable backstop: fires even if the room hibernated with no traffic. */
  async onAlarm(): Promise<void> {
    this.tick();
  }

  // ---------------------------------------------------------------- state

  private ensureState(mode: GameMode): MatchState {
    if (this.state) return this.state;
    const cfg = MODE_CONFIG[mode];
    this.state = {
      matchId: this.ctx.id.name ?? crypto.randomUUID(),
      mode,
      phase: "LOBBY",
      roundNumber: 0,
      phaseEndsAt: Date.now() + cfg.lobbyMs,
      questionStartedAt: 0,
      questions: buildQuestionSet(cfg.totalRounds),
      players: {},
      order: [],
      winnerId: null,
      botsSpawned: false,
    };
    return this.state;
  }

  private persist(): void {
    if (!this.state) return;
    // High-frequency, fully reconstructible game state: skip the output gate
    // so broadcasts are never held behind a storage write.
    this.ctx.storage.put(STATE_KEY, this.state, { allowUnconfirmed: true });
  }

  // ---------------------------------------------------------------- clock

  private armPhaseTimer(): void {
    const state = this.state;
    if (!state || state.phase === "FINISHED") return;

    if (this.phaseTimer !== null) clearTimeout(this.phaseTimer);
    const delay = Math.max(50, state.phaseEndsAt - Date.now());
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      this.tick();
    }, delay);

    // Backstop in case the room is evicted before the timeout fires.
    this.ctx.waitUntil(
      this.env.DO
        .setAlarm("MatchRoom", this.ctx.id.name ?? "", state.phaseEndsAt + 2_000)
        .catch(() => undefined),
    );
  }

  private tick(): void {
    const state = this.state;
    if (!state || state.phase === "FINISHED") return;

    if (Date.now() < state.phaseEndsAt - 40) {
      this.armPhaseTimer();
      return;
    }

    if (state.phase === "LOBBY") this.startMatch();
    else if (state.phase === "QUESTION") this.revealRound();
    else if (state.phase === "REVEAL") this.advanceAfterReveal();

    this.persist();
    this.broadcast();
    this.armPhaseTimer();
  }

  // ---------------------------------------------------------------- phases

  private startMatch(): void {
    const state = this.state;
    if (!state) return;
    const cfg = MODE_CONFIG[state.mode];

    if (!state.botsSpawned) {
      this.spawnBots();
      state.botsSpawned = true;
    }

    if (state.order.length === 0) {
      // Nobody is here — hold the lobby open rather than starting an empty match.
      state.phaseEndsAt = Date.now() + cfg.lobbyMs;
      return;
    }

    state.roundNumber = 1;
    this.beginQuestion();
  }

  private beginQuestion(): void {
    const state = this.state;
    if (!state) return;
    const cfg = MODE_CONFIG[state.mode];

    state.phase = "QUESTION";
    state.questionStartedAt = Date.now();
    state.phaseEndsAt = state.questionStartedAt + cfg.questionMs;

    for (const id of state.order) {
      const p = state.players[id];
      if (!p) continue;
      p.answerIndex = null;
      p.answeredAt = null;
      p.lastAnswerCorrect = null;
      p.removedOptions = [];
      p.shieldActive = false;
      p.doubleActive = false;
    }

    this.scheduleBotAnswers();
  }

  private revealRound(): void {
    const state = this.state;
    if (!state) return;
    const cfg = MODE_CONFIG[state.mode];
    const question = state.questions[state.roundNumber - 1];
    if (!question) {
      this.finishMatch();
      return;
    }

    this.clearBotTimers();
    this.resolveOutstandingBots(question);

    const eliminatedThisRound: PlayerState[] = [];

    for (const id of state.order) {
      const p = state.players[id];
      if (!p || !p.alive) continue;

      const correct = p.answerIndex === question.correct;
      p.lastAnswerCorrect = correct;

      if (correct) {
        p.correctCount += 1;
        p.streak += 1;
        p.bestStreak = Math.max(p.bestStreak, p.streak);
        p.score += this.scoreFor(p, cfg.questionMs);
      } else {
        p.streak = 0;
        if (state.mode === "PRACTICE") continue;

        // Double Down is a gamble: it voids the shield when it loses.
        if (p.shieldActive && !p.doubleActive) {
          p.shieldActive = false;
        } else {
          p.lives -= p.doubleActive ? 2 : 1;
          if (p.lives <= 0) {
            p.lives = 0;
            p.alive = false;
            eliminatedThisRound.push(p);
          }
        }
      }
    }

    // Everyone knocked out in the same round shares the same placement.
    if (eliminatedThisRound.length > 0) {
      const aliveAfter = state.order.filter((id) => state.players[id]?.alive).length;
      for (const p of eliminatedThisRound) p.placement = aliveAfter + 1;
    }

    state.phase = "REVEAL";
    state.phaseEndsAt = Date.now() + cfg.revealMs;
  }

  private advanceAfterReveal(): void {
    const state = this.state;
    if (!state) return;
    const cfg = MODE_CONFIG[state.mode];

    const aliveIds = state.order.filter((id) => state.players[id]?.alive);
    const isLastRound = state.roundNumber >= cfg.totalRounds;
    const royaleOver = state.mode !== "PRACTICE" && aliveIds.length <= 1;

    if (isLastRound || royaleOver || aliveIds.length === 0) {
      this.finishMatch();
      return;
    }

    state.roundNumber += 1;
    this.beginQuestion();
  }

  private finishMatch(): void {
    const state = this.state;
    if (!state) return;

    this.clearBotTimers();
    if (this.phaseTimer !== null) {
      clearTimeout(this.phaseTimer);
      this.phaseTimer = null;
    }

    const survivors = state.order
      .map((id) => state.players[id])
      .filter((p): p is PlayerState => Boolean(p?.alive))
      .sort((a, b) => b.score - a.score);

    const winner = survivors[0] ?? null;
    if (winner) {
      state.winnerId = winner.id;
      survivors.forEach((p, i) => {
        p.placement = i + 1;
      });
    }

    state.phase = "FINISHED";
    state.phaseEndsAt = Date.now();
  }

  /** Base + speed bonus + streak bonus, adjusted by the round's power-ups. */
  private scoreFor(p: PlayerState, questionMs: number): number {
    const answeredAt = p.answeredAt ?? Date.now();
    const started = this.state?.questionStartedAt ?? answeredAt;
    const elapsed = Math.max(0, Math.min(questionMs, answeredAt - started));
    const speedBonus = Math.round(100 * (1 - elapsed / questionMs));
    const streakBonus = Math.min(100, Math.max(0, p.streak - 1) * 25);

    let total = 100 + speedBonus + streakBonus;
    // Fifty-fifty trades points for safety.
    if (p.removedOptions.length > 0) total = Math.round(total * 0.6);
    if (p.doubleActive) total *= 2;
    return total;
  }

  // ---------------------------------------------------------------- intents

  private handleAnswer(ws: WebSocket, playerId: string, questionId: string, answerIndex: number): void {
    const state = this.state;
    if (!state) return;

    const player = state.players[playerId];
    if (!player) {
      this.sendError(ws, "NOT_IN_MATCH", "You are spectating this match.");
      return;
    }
    if (state.phase !== "QUESTION") {
      this.sendError(ws, "WRONG_PHASE", "That round is already over.");
      return;
    }
    if (!player.alive) return;
    if (player.answerIndex !== null) return;

    const question = state.questions[state.roundNumber - 1];
    // A stale answer from the previous round must never land on this one.
    if (!question || question.id !== questionId) {
      this.sendError(ws, "STALE_ROUND", "That answer was for a previous round.");
      return;
    }
    if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= question.options.length) {
      this.sendError(ws, "BAD_ANSWER", "Invalid answer index.");
      return;
    }
    if (player.removedOptions.includes(answerIndex)) return;

    player.answerIndex = answerIndex;
    player.answeredAt = Date.now();

    this.persist();
    this.broadcast();
    this.maybeEndRoundEarly();
  }

  private handlePowerUp(ws: WebSocket, playerId: string, powerUp: PowerUp): void {
    const state = this.state;
    if (!state) return;

    const player = state.players[playerId];
    if (!player || !player.alive) return;
    if (state.phase !== "QUESTION") {
      this.sendError(ws, "WRONG_PHASE", "Power-ups only work during a live round.");
      return;
    }
    if (!ALL_POWER_UPS.includes(powerUp)) return;
    if (player.spentPowerUps.includes(powerUp)) {
      this.sendError(ws, "POWERUP_SPENT", "You already used that power-up.");
      return;
    }
    if (player.answerIndex !== null) {
      this.sendError(ws, "ALREADY_ANSWERED", "You have already locked in an answer.");
      return;
    }

    const question = state.questions[state.roundNumber - 1];
    if (!question) return;

    player.spentPowerUps.push(powerUp);

    if (powerUp === "FIFTY_FIFTY") {
      const wrong = question.options
        .map((_, i) => i)
        .filter((i) => i !== question.correct);
      player.removedOptions = shuffleInPlace(wrong).slice(0, 2);
    } else if (powerUp === "SHIELD") {
      player.shieldActive = true;
    } else if (powerUp === "DOUBLE_DOWN") {
      player.doubleActive = true;
    }

    this.persist();
    this.sendTo(ws, playerId);
    this.broadcast();
  }

  private handleLeave(playerId: string): void {
    const state = this.state;
    if (!state) return;
    const player = state.players[playerId];
    if (!player) return;

    player.connected = false;
    if (state.phase === "LOBBY") {
      delete state.players[playerId];
      state.order = state.order.filter((id) => id !== playerId);
    } else if (player.alive && state.mode !== "PRACTICE") {
      player.alive = false;
      const aliveAfter = state.order.filter((id) => state.players[id]?.alive).length;
      player.placement = aliveAfter + 1;
    }
    this.persist();
    this.broadcast();
  }

  /** Once every survivor has locked in, cut the round short. */
  private maybeEndRoundEarly(): void {
    const state = this.state;
    if (!state || state.phase !== "QUESTION") return;

    const alive = state.order
      .map((id) => state.players[id])
      .filter((p): p is PlayerState => Boolean(p?.alive));
    if (alive.length === 0) return;
    if (alive.some((p) => p.answerIndex === null)) return;

    const early = Date.now() + 700;
    if (early < state.phaseEndsAt) {
      state.phaseEndsAt = early;
      this.armPhaseTimer();
      this.broadcast();
    }
  }

  // ---------------------------------------------------------------- bots

  private spawnBots(): void {
    const state = this.state;
    if (!state) return;
    const cfg = MODE_CONFIG[state.mode];
    if (cfg.botFill <= 0) return;

    const humans = humanCount(state);
    const target = Math.min(cfg.maxPlayers, Math.max(cfg.botFill, humans + 3));
    const needed = Math.max(0, target - state.order.length);

    const pool = shuffleInPlace([...BOT_NAMES]);
    for (let i = 0; i < needed; i += 1) {
      const id = `bot-${i}-${Math.random().toString(36).slice(2, 7)}`;
      const bot = newPlayer(id, pool[i % pool.length] ?? `Rival ${i + 1}`, true, cfg.lives);
      bot.botSkill = 0.45 + Math.random() * 0.42;
      state.players[id] = bot;
      state.order.push(id);
    }
  }

  private scheduleBotAnswers(): void {
    const state = this.state;
    if (!state) return;
    const cfg = MODE_CONFIG[state.mode];
    const question = state.questions[state.roundNumber - 1];
    if (!question) return;

    this.clearBotTimers();
    const round = state.roundNumber;

    for (const id of state.order) {
      const bot = state.players[id];
      if (!bot?.isBot || !bot.alive) continue;

      const delay = 1_200 + Math.random() * Math.max(1_000, cfg.questionMs - 3_200);
      const handle = setTimeout(() => {
        const s = this.state;
        if (!s || s.phase !== "QUESTION" || s.roundNumber !== round) return;
        const target = s.players[id];
        if (!target || !target.alive || target.answerIndex !== null) return;

        target.answerIndex = pickBotAnswer(question, target.botSkill);
        target.answeredAt = Date.now();
        this.persist();
        this.broadcast();
        this.maybeEndRoundEarly();
      }, delay);
      this.botTimers.push(handle);
    }
  }

  /** Resolves bots that never got a timer (e.g. the room hibernated mid-round). */
  private resolveOutstandingBots(question: Question): void {
    const state = this.state;
    if (!state) return;
    for (const id of state.order) {
      const bot = state.players[id];
      if (!bot?.isBot || !bot.alive || bot.answerIndex !== null) continue;
      bot.answerIndex = pickBotAnswer(question, bot.botSkill);
      bot.answeredAt = Date.now();
    }
  }

  private clearBotTimers(): void {
    for (const t of this.botTimers) clearTimeout(t);
    this.botTimers = [];
  }

  // ---------------------------------------------------------------- output

  private broadcast(): void {
    for (const ws of this.ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as { playerId: string } | null;
      if (!attachment?.playerId) continue;
      this.sendTo(ws, attachment.playerId);
    }
  }

  private sendTo(ws: WebSocket, playerId: string): void {
    const state = this.state;
    if (!state) return;
    safeSend(ws, {
      type: "STATE",
      match: this.publicMatch(state),
      you: this.youState(state, playerId),
    });
  }

  private publicMatch(state: MatchState): PublicMatch {
    const revealed = state.phase === "REVEAL" || state.phase === "FINISHED";
    const question = state.questions[state.roundNumber - 1] ?? null;
    const cfg = MODE_CONFIG[state.mode];

    const players: PublicPlayer[] = state.order
      .map((id) => state.players[id])
      .filter((p): p is PlayerState => Boolean(p))
      .map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        alive: p.alive,
        score: p.score,
        streak: p.streak,
        lives: p.lives,
        hasAnswered: p.answerIndex !== null,
        lastAnswerCorrect: revealed ? p.lastAnswerCorrect : null,
        placement: p.placement,
      }))
      .sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        if (a.alive) return b.score - a.score;
        return (a.placement ?? 999) - (b.placement ?? 999);
      });

    return {
      matchId: state.matchId,
      mode: state.mode,
      phase: state.phase,
      roundNumber: state.roundNumber,
      totalRounds: cfg.totalRounds,
      phaseEndsAt: state.phaseEndsAt,
      serverNow: Date.now(),
      question:
        question && state.phase !== "LOBBY"
          ? {
              id: question.id,
              category: question.category,
              difficulty: question.difficulty,
              text: question.text,
              options: question.options,
            }
          : null,
      correctIndex: revealed && question ? question.correct : null,
      players,
      aliveCount: players.filter((p) => p.alive).length,
      totalPlayers: players.length,
      winnerId: state.winnerId,
    };
  }

  private youState(state: MatchState, playerId: string): YouState {
    const p = state.players[playerId];
    if (!p) {
      return {
        playerId,
        alive: false,
        score: 0,
        streak: 0,
        lives: 0,
        placement: null,
        answerIndex: null,
        removedOptions: [],
        availablePowerUps: [],
        shieldActive: false,
        doubleActive: false,
      };
    }
    return {
      playerId,
      alive: p.alive,
      score: p.score,
      streak: p.streak,
      lives: p.lives,
      placement: p.placement,
      answerIndex: p.answerIndex,
      removedOptions: p.removedOptions,
      availablePowerUps: ALL_POWER_UPS.filter((pu) => !p.spentPowerUps.includes(pu)),
      shieldActive: p.shieldActive,
      doubleActive: p.doubleActive,
    };
  }

  private sendError(ws: WebSocket, code: string, message: string): void {
    safeSend(ws, { type: "ERROR", code, message });
  }
}

// ------------------------------------------------------------------ helpers

function newPlayer(id: string, name: string, isBot: boolean, lives: number): PlayerState {
  return {
    id,
    name,
    isBot,
    botSkill: 0.6,
    connected: !isBot,
    alive: true,
    score: 0,
    streak: 0,
    bestStreak: 0,
    correctCount: 0,
    lives,
    placement: null,
    answerIndex: null,
    answeredAt: null,
    lastAnswerCorrect: null,
    removedOptions: [],
    spentPowerUps: [],
    shieldActive: false,
    doubleActive: false,
  };
}

function pickBotAnswer(question: Question, skill: number): number {
  if (Math.random() < skill) return question.correct;
  const wrong = question.options.map((_, i) => i).filter((i) => i !== question.correct);
  return wrong[Math.floor(Math.random() * wrong.length)] ?? question.correct;
}

function humanCount(state: MatchState): number {
  return state.order.filter((id) => state.players[id] && !state.players[id]!.isBot).length;
}

function parseMode(raw: string | null): GameMode {
  if (raw === "TOURNAMENT" || raw === "PRACTICE" || raw === "QUICK") return raw;
  return "QUICK";
}

function sanitizeName(raw: string | null): string {
  const trimmed = (raw ?? "").trim().slice(0, 16);
  return trimmed.length > 0 ? trimmed : "Challenger";
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = arr[i]!;
    const b = arr[j]!;
    arr[i] = b;
    arr[j] = a;
  }
  return arr;
}

function safeSend(ws: WebSocket, msg: ServerMessage): void {
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    // Socket may be mid-close; the next broadcast will skip it.
  }
}
