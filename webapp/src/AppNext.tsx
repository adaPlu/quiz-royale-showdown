import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Bolt,
  Crown,
  Gamepad2,
  Home,
  LogIn,
  Medal,
  Shield,
  ShoppingBag,
  Sparkles,
  Trophy,
  UserPlus,
  UserRound,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import {
  createPrivateMatch,
  findMatch,
  joinPrivateMatch,
  loadSeason,
  loadStore,
  login,
  logout,
  openMatchSocket,
  purchaseStoreItem,
  refreshIdentity,
  register,
  restoreIdentity,
  updatePrivateMatch,
} from "./api";
import { CosmeticsPanel, FriendsPanel, LeaderboardPanel } from "./FeaturePanels";
import { PrivateMatchPanel } from "./PrivateMatchPanel";
import {
  GUEST_ACTIVITY_WINDOW_MS,
  formatRemaining,
  guestExpiryLevel,
  guestRemainingMs,
  heartbeatGuest,
} from "./guest-session";
import type {
  CurrentSeasonEnvelope,
  GameMode,
  Identity,
  MainRoute,
  MatchDifficulty,
  MatchmakeResponse,
  PowerUp,
  PrivateMatchResponse,
  PublicMatch,
  PublicPlayer,
  ServerMessage,
  StoreItemsEnvelope,
  YouState,
} from "./types";
import "./app-next.css";

const MODE_INFO: Record<GameMode, {
  title: string;
  tagline: string;
  description: string;
  accent: string;
  lobbyMs: number;
  questionMs: number;
  revealMs: number;
}> = {
  QUICK: {
    title: "QUICK MATCH",
    tagline: "One life. Twelve rounds.",
    description: "Drop into the next open lobby. A single wrong answer ends your run.",
    accent: "gold",
    lobbyMs: 12_000,
    questionMs: 12_000,
    revealMs: 4_500,
  },
  TOURNAMENT: {
    title: "TOURNAMENT",
    tagline: "Two lives. Bigger arena.",
    description: "Sixteen players, fifteen brutal rounds and a shorter clock. Survive to the crown.",
    accent: "magenta",
    lobbyMs: 15_000,
    questionMs: 10_000,
    revealMs: 4_000,
  },
  PRACTICE: {
    title: "PRACTICE",
    tagline: "No elimination. No pressure.",
    description: "Solo run through ten questions with a relaxed clock. Nothing can knock you out.",
    accent: "cyan",
    lobbyMs: 2_500,
    questionMs: 18_000,
    revealMs: 5_000,
  },
};

type LiveMatch = { match: PublicMatch; you: YouState };
type ConnectionState = "idle" | "connecting" | "live" | "reconnecting" | "offline";

export default function AppNext() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [route, setRoute] = useState<MainRoute>("home");
  const [live, setLive] = useState<LiveMatch | null>(null);
  const [joiningMode, setJoiningMode] = useState<GameMode | null>(null);
  const [privateRoom, setPrivateRoom] = useState<PrivateMatchResponse | null>(null);
  const [privateBusy, setPrivateBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>("idle");

  const socketRef = useRef<WebSocket | null>(null);
  const assignmentRef = useRef<MatchmakeResponse | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const joinWatchdogRef = useRef<number | null>(null);
  const intentionalCloseRef = useRef(false);
  const finishedRef = useRef(false);
  const hasStateRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const heartbeatBusyRef = useRef(false);

  useEffect(() => {
    restoreIdentity().then(setIdentity).catch((error: Error) => setMessage(error.message));
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current != null) window.clearTimeout(reconnectTimerRef.current);
      if (joinWatchdogRef.current != null) window.clearTimeout(joinWatchdogRef.current);
      socketRef.current?.close();
    };
  }, []);

  useEffect(() => {
    const markActivity = () => { lastActivityRef.current = Date.now(); };
    window.addEventListener("pointerdown", markActivity, { passive: true });
    window.addEventListener("keydown", markActivity);
    return () => {
      window.removeEventListener("pointerdown", markActivity);
      window.removeEventListener("keydown", markActivity);
    };
  }, []);

  useEffect(() => {
    if (!identity || identity.kind !== "guest") return;
    const guestId = identity.guest.guestId;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - lastActivityRef.current > GUEST_ACTIVITY_WINDOW_MS) return;
      if (heartbeatBusyRef.current) return;
      heartbeatBusyRef.current = true;
      try {
        const current = await heartbeatGuest(identity);
        if (current.kind === "guest" && current.guest.guestId === guestId) setIdentity(current);
      } catch {
        if (identity.guest.expiresAt <= Date.now()) {
          restoreIdentity()
            .then((fresh) => {
              setIdentity(fresh);
              setMessage("Guest session expired; a new challenger session was created.");
            })
            .catch(() => setMessage("Guest session expired. Refresh to start a new session."));
        }
      } finally {
        heartbeatBusyRef.current = false;
      }
    };
    const interval = window.setInterval(() => void tick(), 30_000);
    return () => window.clearInterval(interval);
  }, [identity?.kind, identity?.kind === "guest" ? identity.guest.guestId : null]);

  function failConnection(error: unknown, fallback: string) {
    if (joinWatchdogRef.current != null) {
      window.clearTimeout(joinWatchdogRef.current);
      joinWatchdogRef.current = null;
    }
    setJoiningMode(null);
    setPrivateBusy(false);
    setConnectionState("offline");
    setMessage(error instanceof Error ? error.message : fallback);
  }

  async function waitForReconnect(attempt: number): Promise<void> {
    await new Promise<void>((resolve) => {
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        resolve();
      }, 750 * (attempt + 1));
    });
  }

  async function connectAssignment(activeIdentity: Identity, assignment: MatchmakeResponse, attempt = 0): Promise<void> {
    setConnectionState(attempt === 0 ? "connecting" : "reconnecting");
    try {
      const socket = await openMatchSocket(
        activeIdentity,
        assignment,
        (packet: ServerMessage) => {
          if (packet.type === "STATE") {
            hasStateRef.current = true;
            if (joinWatchdogRef.current != null) {
              window.clearTimeout(joinWatchdogRef.current);
              joinWatchdogRef.current = null;
            }
            setJoiningMode(null);
            setPrivateBusy(false);
            setLive({ match: packet.match, you: packet.you });
            setConnectionState("live");
            finishedRef.current = packet.match.phase === "FINISHED";
          } else if (packet.type === "ERROR") {
            setMessage(packet.message);
          }
        },
        () => {
          if (intentionalCloseRef.current || finishedRef.current) return;
          if (attempt < 2 && assignmentRef.current) {
            setConnectionState("reconnecting");
            reconnectTimerRef.current = window.setTimeout(
              () => {
                reconnectTimerRef.current = null;
                void connectAssignment(activeIdentity, assignment, attempt + 1).catch((error) => {
                  failConnection(error, "Could not reconnect to the arena.");
                });
              },
              750 * (attempt + 1),
            );
          } else {
            failConnection(new Error("Connection lost. Return to Play and re-enter the arena."), "Connection lost.");
          }
        },
        (failure) => setMessage(failure),
      );
      socketRef.current = socket;
    } catch (error) {
      if (attempt < 2 && !intentionalCloseRef.current) {
        setConnectionState("reconnecting");
        await waitForReconnect(attempt);
        if (intentionalCloseRef.current) return;
        return connectAssignment(activeIdentity, assignment, attempt + 1);
      }
      throw error;
    }
  }

  async function enterAssignment(assignment: MatchmakeResponse) {
    if (!identity) return;
    setJoiningMode(assignment.mode);
    setMessage(null);
    setLive(null);
    intentionalCloseRef.current = false;
    finishedRef.current = false;
    hasStateRef.current = false;
    if (joinWatchdogRef.current != null) window.clearTimeout(joinWatchdogRef.current);
    assignmentRef.current = assignment;
    socketRef.current?.close();
    await connectAssignment(identity, assignment);
    joinWatchdogRef.current = window.setTimeout(() => {
      if (hasStateRef.current || intentionalCloseRef.current) return;
      intentionalCloseRef.current = true;
      socketRef.current?.close();
      setJoiningMode(null);
      setPrivateBusy(false);
      setConnectionState("offline");
      setMessage("Arena handshake timed out. Try entering the match again.");
    }, 20_000);
  }

  async function startMatch(mode: GameMode) {
    if (!identity || joiningMode) return;
    setJoiningMode(mode);
    try {
      await enterAssignment(await findMatch(mode));
    } catch (error) {
      failConnection(error, "Could not enter the arena.");
    }
  }

  async function createPrivateRoom(mode: GameMode, difficulty: MatchDifficulty) {
    if (!identity || privateBusy) return;
    setPrivateBusy(true);
    setMessage(null);
    try {
      const room = await createPrivateMatch(identity, mode, difficulty);
      setPrivateRoom(room);
      setMessage(`Private room ${room.code} created. Share the code, then enter when ready.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create private room.");
    } finally {
      setPrivateBusy(false);
    }
  }

  async function updatePrivateRoom(mode: GameMode, difficulty: MatchDifficulty) {
    if (!identity || !privateRoom || privateBusy) return;
    setPrivateBusy(true);
    setMessage(null);
    try {
      setPrivateRoom(await updatePrivateMatch(identity, privateRoom.code, mode, difficulty));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update private room.");
    } finally {
      setPrivateBusy(false);
    }
  }

  async function joinPrivateRoom(code: string) {
    if (!identity || privateBusy) return;
    setPrivateBusy(true);
    setMessage(null);
    try {
      await enterAssignment(await joinPrivateMatch(identity, code));
    } catch (error) {
      failConnection(error, "Could not join private room.");
    }
  }

  async function enterHostedPrivateRoom() {
    if (!identity || !privateRoom || privateBusy) return;
    setPrivateBusy(true);
    try {
      await enterAssignment(await joinPrivateMatch(identity, privateRoom.code));
    } catch (error) {
      failConnection(error, "Could not enter private room.");
    }
  }

  async function exitMatch() {
    intentionalCloseRef.current = true;
    if (reconnectTimerRef.current != null) window.clearTimeout(reconnectTimerRef.current);
    if (joinWatchdogRef.current != null) window.clearTimeout(joinWatchdogRef.current);
    socketRef.current?.send(JSON.stringify({ type: "LEAVE_MATCH" }));
    socketRef.current?.close();
    socketRef.current = null;
    assignmentRef.current = null;
    setLive(null);
    setJoiningMode(null);
    setPrivateBusy(false);
    setConnectionState("idle");
    if (identity) refreshIdentity(identity).then(setIdentity).catch(() => undefined);
    setRoute("home");
  }

  if (!identity) return <LoadingScreen message={message ?? "Entering the arena…"} />;

  if (live) {
    return <MatchScreen live={live} socket={socketRef.current} connectionState={connectionState} onExit={exitMatch} />;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <main className="screen-shell" id="main-content" tabIndex={-1}>
        {route === "home" && <HomeScreen identity={identity} onIdentity={setIdentity} onNavigate={setRoute} />}
        {route === "play" && (
          <PlayScreen
            joiningMode={joiningMode}
            privateRoom={privateRoom}
            privateBusy={privateBusy}
            onPlay={startMatch}
            onCreatePrivate={createPrivateRoom}
            onUpdatePrivate={updatePrivateRoom}
            onJoinPrivate={joinPrivateRoom}
            onEnterPrivate={enterHostedPrivateRoom}
          />
        )}
        {route === "store" && <StoreScreen identity={identity} onIdentity={setIdentity} />}
        {route === "season" && <SeasonScreen identity={identity} />}
        {route === "profile" && <ProfileScreen identity={identity} onIdentity={setIdentity} onMessage={setMessage} />}
      </main>

      {message && (
        <button className="toast" onClick={() => setMessage(null)} aria-label="Dismiss message" role="status" aria-live="polite">
          {message}
        </button>
      )}
      <MainNav route={route} onNavigate={setRoute} />
    </div>
  );
}

function MainNav({ route, onNavigate }: { route: MainRoute; onNavigate: (route: MainRoute) => void }) {
  const destinations: Array<{ route: MainRoute; label: string; icon: ReactNode }> = [
    { route: "home", label: "HOME", icon: <Home size={21} aria-hidden="true" /> },
    { route: "play", label: "PLAY", icon: <Gamepad2 size={21} aria-hidden="true" /> },
    { route: "store", label: "STORE", icon: <ShoppingBag size={21} aria-hidden="true" /> },
    { route: "season", label: "SEASON", icon: <Sparkles size={21} aria-hidden="true" /> },
    { route: "profile", label: "PROFILE", icon: <UserRound size={21} aria-hidden="true" /> },
  ];

  return (
    <nav className="main-nav" aria-label="Primary">
      {destinations.map((item) => (
        <button key={item.route} className={route === item.route ? "nav-item selected" : "nav-item"} onClick={() => onNavigate(item.route)} aria-current={route === item.route ? "page" : undefined}>
          {item.icon}<span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function HomeScreen({ identity, onIdentity, onNavigate }: { identity: Identity; onIdentity: (identity: Identity) => void; onNavigate: (route: MainRoute) => void }) {
  const stats = identity.kind === "user" ? identity.profile.stats : identity.guest.stats;
  const name = identity.kind === "user" ? identity.profile.username : identity.guest.displayName;
  return (
    <ArenaPage>
      <header className="hero compact-hero">
        <div className="crown-mark"><Crown size={44} aria-hidden="true" /></div>
        <h1><span>QUIZ</span><span>ROYALE</span></h1><p className="showdown">S H O W D O W N</p>
      </header>
      <section className="arena-card account-card">
        <div><p className="eyebrow">{identity.kind === "user" ? "REGISTERED PLAYER" : "GUEST CHALLENGER"}</p><h2>{name}</h2></div>
        <Medal className="gold-text" size={30} aria-hidden="true" />
      </section>
      {identity.kind === "guest" && <GuestSessionBanner identity={identity} onIdentity={onIdentity} onProfile={() => onNavigate("profile")} />}
      {identity.kind === "guest" && (
        <button className="conversion-card" onClick={() => onNavigate("profile")}>
          <UserPlus size={22} aria-hidden="true" /><span><strong>Make it permanent</strong><small>Keep your points, friends and rank.</small></span>
        </button>
      )}
      <div className="stat-grid">
        <Stat label="POINTS" value={stats.totalPoints} /><Stat label="WINS" value={stats.wins} /><Stat label="MATCHES" value={stats.matchesPlayed} /><Stat label="BEST" value={stats.bestScore} />
      </div>
      <section className="quick-actions" aria-label="Quick actions">
        <button className="arena-card action-card gold-border" onClick={() => onNavigate("play")}><Bolt size={24} aria-hidden="true" /><strong>PLAY</strong><small>Choose your arena</small></button>
        <button className="arena-card action-card gold-border" onClick={() => onNavigate("store")}><ShoppingBag size={24} aria-hidden="true" /><strong>STORE</strong><small>Power-ups & cosmetics</small></button>
        <button className="arena-card action-card violet-border" onClick={() => onNavigate("season")}><Sparkles size={24} aria-hidden="true" /><strong>SEASON</strong><small>Progress & rewards</small></button>
        <button className="arena-card action-card" onClick={() => onNavigate("profile")}><UserRound size={24} aria-hidden="true" /><strong>PROFILE</strong><small>Account & friends</small></button>
      </section>
      <LeaderboardPanel identity={identity} />
    </ArenaPage>
  );
}

function GuestSessionBanner({ identity, onIdentity, onProfile }: { identity: Extract<Identity, { kind: "guest" }>; onIdentity: (identity: Identity) => void; onProfile: () => void }) {
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, []);
  const remaining = guestRemainingMs(identity, now) ?? 0;
  const level = guestExpiryLevel(remaining);

  async function extend() {
    setBusy(true);
    try { onIdentity(await heartbeatGuest(identity)); } finally { setBusy(false); }
  }

  if (level === "safe") {
    return <div className="guest-session-chip" aria-label={`Guest session ${formatRemaining(remaining)} remaining`}>Guest session · {formatRemaining(remaining)}</div>;
  }

  return (
    <section className={`guest-expiry ${level}`} role="status" aria-live="polite">
      <strong>{level === "lapsed" ? "Guest session expired" : `Guest session ${formatRemaining(remaining)} left`}</strong>
      <span>{level === "lapsed" ? "Register or refresh to continue with a fresh guest." : "Stay active or register to preserve progress permanently."}</span>
      <div><button onClick={() => void extend()} disabled={busy || level === "lapsed"}>{busy ? "EXTENDING…" : "EXTEND"}</button><button onClick={onProfile}>REGISTER</button></div>
    </section>
  );
}

function PlayScreen({
  joiningMode,
  privateRoom,
  privateBusy,
  onPlay,
  onCreatePrivate,
  onUpdatePrivate,
  onJoinPrivate,
  onEnterPrivate,
}: {
  joiningMode: GameMode | null;
  privateRoom: PrivateMatchResponse | null;
  privateBusy: boolean;
  onPlay: (mode: GameMode) => void;
  onCreatePrivate: (mode: GameMode, difficulty: MatchDifficulty) => Promise<void>;
  onUpdatePrivate: (mode: GameMode, difficulty: MatchDifficulty) => Promise<void>;
  onJoinPrivate: (code: string) => Promise<void>;
  onEnterPrivate: () => Promise<void>;
}) {
  return (
    <ArenaPage title="PLAY" subtitle="Choose your arena">
      <div className="mode-list">
        {(Object.keys(MODE_INFO) as GameMode[]).map((mode) => {
          const info = MODE_INFO[mode];
          return (
            <button key={mode} className={`mode-card ${info.accent}`} onClick={() => onPlay(mode)} disabled={joiningMode !== null || privateBusy}>
              <div className="mode-heading">{mode === "QUICK" ? <Bolt aria-hidden="true" /> : mode === "TOURNAMENT" ? <Trophy aria-hidden="true" /> : <Medal aria-hidden="true" />}<span><strong>{info.title}</strong><small>{info.tagline}</small></span></div>
              <p>{info.description}</p><span className="enter-label" aria-live="polite">{joiningMode === mode ? "FINDING ARENA…" : "ENTER ARENA →"}</span>
            </button>
          );
        })}
      </div>
      <PrivateMatchPanel room={privateRoom} busy={privateBusy} onCreate={onCreatePrivate} onUpdate={onUpdatePrivate} onJoin={onJoinPrivate} onEnter={onEnterPrivate} />
    </ArenaPage>
  );
}

function StoreScreen({ identity, onIdentity }: { identity: Identity; onIdentity: (identity: Identity) => void }) {
  const [store, setStore] = useState<StoreItemsEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => { setStore(null); setError(null); loadStore(identity).then(setStore).catch((e: Error) => setError(e.message)); }, [identity]);
  if (identity.kind === "guest") return <LockedPage title="STORE" message="Register or sign in to buy power-ups, passes and cosmetics." />;
  async function purchase(itemId: string) {
    setBusy(itemId); setError(null);
    try { setStore(await purchaseStoreItem(identity, itemId)); onIdentity(await refreshIdentity(identity)); }
    catch (e) { setError(e instanceof Error ? e.message : "Purchase failed."); }
    finally { setBusy(null); }
  }
  return (
    <ArenaPage title="STORE" subtitle="Power-ups, passes and cosmetics">
      {store && <div className="balance-strip"><span>🪙 {store.balances.coins}</span><span>💎 {store.balances.gems}</span><span>🎟 {store.balances.seasonalTickets}</span></div>}
      {error && <InlineError>{error}</InlineError>}{!store && !error && <p className="muted" aria-live="polite">Loading inventory…</p>}
      <div className="item-grid">{store?.items.map((item) => <article className="arena-card store-item" key={item.itemId}><p className="eyebrow">{item.itemType}</p><h3>{item.displayName}</h3><p>{item.description}</p><button className="primary-button" disabled={item.owned || busy !== null} onClick={() => purchase(item.itemId)}>{item.owned ? "OWNED" : busy === item.itemId ? "PURCHASING…" : `${item.price} ${item.currency}`}</button></article>)}</div>
      <CosmeticsPanel identity={identity} />
    </ArenaPage>
  );
}

function SeasonScreen({ identity }: { identity: Identity }) {
  const [season, setSeason] = useState<CurrentSeasonEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setSeason(null); setError(null); loadSeason(identity).then(setSeason).catch((e: Error) => setError(e.message)); }, [identity]);
  if (identity.kind === "guest") return <LockedPage title="SEASON" message="Register or sign in to track seasonal XP and rewards." />;

  const progress = season?.progress;
  const levelProgress = progress ? (progress.xp % 1000) / 10 : 0;
  const daysLeft = season ? Math.max(0, Math.ceil((season.season.endsAt - Date.now()) / 86_400_000)) : 0;

  return (
    <ArenaPage title="SEASON" subtitle="Climb the current reward track">
      {error && <InlineError>{error}</InlineError>}
      {!season && !error && <p className="muted" aria-live="polite">Loading season…</p>}
      {season && (
        <>
          <section className="arena-card season-hero">
            <Sparkles className="violet-text" size={34} aria-hidden="true" />
            <div>
              <p className="eyebrow">CURRENT SEASON · {daysLeft} DAYS LEFT</p>
              <h2>{season.season.name}</h2>
              <small>{season.hasSeasonPass ? "Premium pass active" : "Free reward track"}</small>
            </div>
          </section>
          <section className="arena-card">
            <div className="season-level"><strong>LEVEL {progress?.level}</strong><span>{progress?.xp} XP</span></div>
            <div className="progress" role="progressbar" aria-valuenow={levelProgress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${levelProgress}%` }} /></div>
            <p className="muted">Tickets earned: {progress?.ticketsEarned ?? 0} · {1000 - ((progress?.xp ?? 0) % 1000)} XP to next level</p>
          </section>
          <section className="season-track" aria-label="Season reward milestones">
            {season.season.rewardTrack.map((reward, index) => {
              const level = Number(reward.level ?? 1);
              const premium = reward.premium === true;
              const reached = (progress?.level ?? 1) >= level;
              const unlocked = reached && (!premium || season.hasSeasonPass === true);
              return (
                <article className={unlocked ? "arena-card season-reward unlocked" : "arena-card season-reward"} key={`${level}-${index}`}>
                  <div><strong>LEVEL {level}</strong>{premium && <em>PREMIUM</em>}</div>
                  <span>{seasonRewardText(reward)}</span>
                  <small>{unlocked ? "EARNED" : reached && premium ? "PASS REQUIRED" : "LOCKED"}</small>
                </article>
              );
            })}
          </section>
        </>
      )}
    </ArenaPage>
  );
}

function seasonRewardText(reward: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Number(reward.coins) > 0) parts.push(`${Number(reward.coins)} coins`);
  if (Number(reward.gems) > 0) parts.push(`${Number(reward.gems)} gems`);
  if (Number(reward.seasonalTickets) > 0) parts.push(`${Number(reward.seasonalTickets)} bonus tickets`);
  return parts.length > 0 ? parts.join(" · ") : "Mystery reward";
}

function ProfileScreen({ identity, onIdentity, onMessage }: { identity: Identity; onIdentity: (identity: Identity) => void; onMessage: (message: string | null) => void }) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [busy, setBusy] = useState(false);
  if (identity.kind === "guest") {
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault(); setBusy(true); onMessage(null); const form = new FormData(event.currentTarget);
      try { if (mode === "login") onIdentity(await login(String(form.get("identifier") ?? ""), String(form.get("password") ?? ""))); else onIdentity(await register(String(form.get("username") ?? ""), String(form.get("email") ?? ""), String(form.get("password") ?? ""), identity)); }
      catch (error) { onMessage(error instanceof Error ? error.message : "Authentication failed."); }
      finally { setBusy(false); }
    }
    return <ArenaPage title="PROFILE" subtitle="Save your progress permanently"><div className="auth-switch" role="tablist" aria-label="Account action"><button role="tab" aria-selected={mode === "register"} className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}><UserPlus size={18} aria-hidden="true" /> REGISTER</button><button role="tab" aria-selected={mode === "login"} className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}><LogIn size={18} aria-hidden="true" /> SIGN IN</button></div><form className="arena-card auth-form" onSubmit={submit}>{mode === "register" ? <><label>Username<input name="username" autoComplete="username" required minLength={3} /></label><label>Email<input name="email" type="email" autoComplete="email" required /></label></> : <label>Email or username<input name="identifier" autoComplete="username" required /></label>}<label>Password<input name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={8} /></label><button className="primary-button" disabled={busy}>{busy ? "PLEASE WAIT…" : mode === "register" ? "REGISTER & KEEP PROGRESS" : "SIGN IN"}</button></form></ArenaPage>;
  }
  const stats = identity.profile.stats;
  return <ArenaPage title="PROFILE" subtitle={identity.profile.username}><section className="arena-card profile-card"><UserRound size={36} className="gold-text" aria-hidden="true" /><div><h2>{identity.profile.username}</h2><p>{identity.profile.email}</p></div></section><div className="stat-grid"><Stat label="POINTS" value={stats.totalPoints} /><Stat label="WINS" value={stats.wins} /><Stat label="CORRECT" value={stats.correctAnswers} /><Stat label="RANK" value={stats.bestRank ?? "—"} /></div><FriendsPanel identity={identity} onIdentity={onIdentity} /><button className="secondary-button" onClick={async () => onIdentity(await logout(identity))}>SIGN OUT</button></ArenaPage>;
}

function MatchScreen({ live, socket, connectionState, onExit }: { live: LiveMatch; socket: WebSocket | null; connectionState: ConnectionState; onExit: () => void }) {
  const { match, you } = live;
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const interval = window.setInterval(() => setNow(Date.now()), 200); return () => window.clearInterval(interval); }, []);
  const seconds = Math.max(0, Math.ceil((match.phaseEndsAt - now) / 1000));
  const phaseMs = match.phase === "LOBBY" ? MODE_INFO[match.mode].lobbyMs : match.phase === "QUESTION" ? MODE_INFO[match.mode].questionMs : MODE_INFO[match.mode].revealMs;
  const timerPercent = Math.max(0, Math.min(100, ((match.phaseEndsAt - now) / phaseMs) * 100));
  const sortedPlayers = useMemo(() => [...match.players].sort((a, b) => b.score - a.score), [match.players]);
  function answer(index: number) { if (!match.question || you.answerIndex != null || socket?.readyState !== WebSocket.OPEN || match.phase !== "QUESTION") return; socket.send(JSON.stringify({ type: "SUBMIT_ANSWER", questionId: match.question.id, answerIndex: index })); }
  function usePowerUp(powerUp: PowerUp) { if (socket?.readyState !== WebSocket.OPEN || match.phase !== "QUESTION") return; socket.send(JSON.stringify({ type: "USE_POWERUP", powerUp })); }
  useEffect(() => {
    function keyHandler(event: KeyboardEvent) { if (event.key === "Escape") { void onExit(); return; } const index = Number.parseInt(event.key, 10) - 1; if (index >= 0 && index <= 3) answer(index); }
    window.addEventListener("keydown", keyHandler); return () => window.removeEventListener("keydown", keyHandler);
  });
  const resultText = match.phase === "REVEAL" && you.answerIndex != null ? you.answerIndex === match.correctIndex ? "Correct!" : "Not this round." : null;
  return <div className="match-page"><div className="match-topbar"><button onClick={onExit}>← EXIT</button><strong>{match.mode}</strong><span className={`connection-pill ${connectionState}`} aria-live="polite">{connectionState === "live" ? <Wifi size={15} aria-hidden="true" /> : <WifiOff size={15} aria-hidden="true" />}{connectionState === "reconnecting" ? "RECONNECTING" : connectionState === "live" ? `${match.phase === "FINISHED" ? "FINAL" : `${seconds}s`}` : connectionState.toUpperCase()}</span></div><div className="phase-timer" aria-hidden="true"><span style={{ width: `${timerPercent}%` }} /></div><div className="match-content"><div className="match-meta"><p className="eyebrow">ROUND {match.roundNumber} / {match.totalRounds}</p><span>{you.score} pts · streak {you.streak} · lives {you.lives}</span></div>{match.phase === "LOBBY" && <h1>Entering the arena…</h1>}{match.question && <><p className="category">{match.question.category} · {match.question.difficulty}</p><h1 className="question">{match.question.text}</h1>{you.availablePowerUps.length > 0 && match.phase === "QUESTION" && <div className="powerup-row" aria-label="Available power-ups">{you.availablePowerUps.map((powerUp) => <button key={powerUp} onClick={() => usePowerUp(powerUp)} disabled={socket?.readyState !== WebSocket.OPEN}>{powerUp === "SHIELD" ? <Shield size={17} aria-hidden="true" /> : powerUp === "DOUBLE_DOWN" ? <Zap size={17} aria-hidden="true" /> : <Sparkles size={17} aria-hidden="true" />}{powerUpLabel(powerUp)}</button>)}</div>}<div className="answer-grid">{match.question.options.map((option, index) => { const removed = you.removedOptions.includes(index); const selected = you.answerIndex === index; const correct = match.phase === "REVEAL" && match.correctIndex === index; const wrongSelected = match.phase === "REVEAL" && selected && !correct; return <button key={`${match.question?.id}-${index}`} className={`answer ${selected ? "selected" : ""} ${correct ? "correct" : ""} ${wrongSelected ? "wrong" : ""}`} disabled={removed || you.answerIndex != null || match.phase !== "QUESTION"} onClick={() => answer(index)} aria-pressed={selected} aria-label={`Answer ${index + 1}: ${removed ? "removed" : option}`}><span>{String.fromCharCode(65 + index)}</span>{removed ? "—" : option}</button>; })}</div>{resultText && <p className={resultText === "Correct!" ? "answer-result correct-text" : "answer-result wrong-text"} role="status">{resultText}</p>}</>}<section className="arena-card standings" aria-labelledby="standings-title"><div className="season-level"><strong id="standings-title">STANDINGS</strong><span>{match.aliveCount} alive</span></div>{sortedPlayers.slice(0, 8).map((player, index) => <div className={player.id === you.playerId ? "standing you" : "standing"} key={player.id}><span className="standing-player">#{player.placement ?? index + 1} {player.name}{!player.alive ? " · OUT" : ""}<MatchAppearanceTags player={player} /></span><strong>{player.score}</strong></div>)}</section>{match.phase === "FINISHED" && <section className="finish-card"><Crown aria-hidden="true" /><h2>{match.winnerId === you.playerId ? "YOU WON" : `PLACEMENT #${you.placement ?? "—"}`}</h2><p>{you.score} final points</p><button className="primary-button" onClick={onExit}>RETURN HOME</button></section>}<p className="keyboard-hint">Keyboard: 1–4 answers · Esc exits</p></div></div>;
}

function MatchAppearanceTags({ player }: { player: PublicPlayer }) {
  const appearance = player.appearance;
  if (!appearance) return null;
  const tags = [appearance.title?.displayName, appearance.badge?.displayName, appearance.avatarFrame?.displayName, appearance.banner?.displayName].filter((value): value is string => Boolean(value));
  if (tags.length === 0) return null;
  return <small className="match-appearance" aria-label={`Equipped cosmetics: ${tags.join(", ")}`}>{tags.map((tag) => <em key={tag}>{tag}</em>)}</small>;
}

function powerUpLabel(powerUp: PowerUp): string { if (powerUp === "FIFTY_FIFTY") return "50:50"; if (powerUp === "DOUBLE_DOWN") return "Double"; return "Shield"; }
function ArenaPage({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) { return <div className="arena-page">{title && <header className="page-header"><p className="eyebrow">QUIZ ROYALE SHOWDOWN</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</header>}{children}</div>; }
function LockedPage({ title, message }: { title: string; message: string }) { return <ArenaPage title={title}><section className="arena-card locked-card"><Crown size={34} aria-hidden="true" /><h2>Account required</h2><p>{message}</p><small>Open PROFILE below to register or sign in.</small></section></ArenaPage>; }
function Stat({ label, value }: { label: string; value: string | number }) { return <div className="stat"><span>{label}</span><strong>{value}</strong></div>; }
function InlineError({ children }: { children: ReactNode }) { return <div className="inline-error" role="alert">{children}</div>; }
function LoadingScreen({ message }: { message: string }) { return <div className="loading" role="status" aria-live="polite"><Crown size={48} aria-hidden="true" /><h1>QUIZ ROYALE</h1><p>{message}</p></div>; }
