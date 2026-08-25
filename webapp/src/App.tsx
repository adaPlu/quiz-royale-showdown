import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  Bolt,
  Crown,
  Gamepad2,
  Home,
  LogIn,
  Medal,
  ShoppingBag,
  Sparkles,
  Trophy,
  UserPlus,
  UserRound,
} from "lucide-react";
import {
  findMatch,
  loadSeason,
  loadStore,
  login,
  logout,
  openMatchSocket,
  purchaseStoreItem,
  refreshIdentity,
  register,
  restoreIdentity,
} from "./api";
import type {
  CurrentSeasonEnvelope,
  GameMode,
  Identity,
  MainRoute,
  PublicMatch,
  ServerMessage,
  StoreItemsEnvelope,
  YouState,
} from "./types";

const MODE_INFO: Record<GameMode, { title: string; tagline: string; description: string; accent: string }> = {
  QUICK: {
    title: "QUICK MATCH",
    tagline: "One life. Twelve rounds.",
    description: "Drop into the next open lobby. A single wrong answer ends your run.",
    accent: "gold",
  },
  TOURNAMENT: {
    title: "TOURNAMENT",
    tagline: "Two lives. Bigger arena.",
    description: "Sixteen players, fifteen brutal rounds and a shorter clock. Survive to the crown.",
    accent: "magenta",
  },
  PRACTICE: {
    title: "PRACTICE",
    tagline: "No elimination. No pressure.",
    description: "Solo run through ten questions with a relaxed clock. Nothing can knock you out.",
    accent: "cyan",
  },
};

type LiveMatch = { match: PublicMatch; you: YouState };

export default function App() {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [route, setRoute] = useState<MainRoute>("home");
  const [live, setLive] = useState<LiveMatch | null>(null);
  const [joiningMode, setJoiningMode] = useState<GameMode | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    restoreIdentity()
      .then(setIdentity)
      .catch((error: Error) => setMessage(error.message));
    return () => socketRef.current?.close();
  }, []);

  async function startMatch(mode: GameMode) {
    if (!identity || joiningMode) return;
    setJoiningMode(mode);
    setMessage(null);
    try {
      const assignment = await findMatch(mode);
      socketRef.current?.close();
      const socket = await openMatchSocket(
        identity,
        assignment,
        (packet: ServerMessage) => {
          if (packet.type === "STATE") setLive({ match: packet.match, you: packet.you });
          if (packet.type === "ERROR") setMessage(packet.message);
        },
        () => undefined,
        setMessage,
      );
      socketRef.current = socket;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not enter the arena.");
    } finally {
      setJoiningMode(null);
    }
  }

  async function exitMatch() {
    socketRef.current?.send(JSON.stringify({ type: "LEAVE_MATCH" }));
    socketRef.current?.close();
    socketRef.current = null;
    setLive(null);
    if (identity) {
      refreshIdentity(identity).then(setIdentity).catch(() => undefined);
    }
    setRoute("home");
  }

  if (!identity) {
    return <LoadingScreen message={message ?? "Entering the arena…"} />;
  }

  if (live) {
    return <MatchScreen live={live} socket={socketRef.current} onExit={exitMatch} />;
  }

  return (
    <div className="app-shell">
      <main className="screen-shell">
        {route === "home" && <HomeScreen identity={identity} onNavigate={setRoute} />}
        {route === "play" && <PlayScreen joiningMode={joiningMode} onPlay={startMatch} />}
        {route === "store" && <StoreScreen identity={identity} />}
        {route === "season" && <SeasonScreen identity={identity} />}
        {route === "profile" && (
          <ProfileScreen
            identity={identity}
            onIdentity={setIdentity}
            onMessage={setMessage}
          />
        )}
      </main>

      {message && (
        <button className="toast" onClick={() => setMessage(null)} aria-label="Dismiss message">
          {message}
        </button>
      )}

      <MainNav route={route} onNavigate={setRoute} />
    </div>
  );
}

function MainNav({ route, onNavigate }: { route: MainRoute; onNavigate: (route: MainRoute) => void }) {
  const destinations: Array<{ route: MainRoute; label: string; icon: ReactNode }> = [
    { route: "home", label: "HOME", icon: <Home size={21} /> },
    { route: "play", label: "PLAY", icon: <Gamepad2 size={21} /> },
    { route: "store", label: "STORE", icon: <ShoppingBag size={21} /> },
    { route: "season", label: "SEASON", icon: <Sparkles size={21} /> },
    { route: "profile", label: "PROFILE", icon: <UserRound size={21} /> },
  ];

  return (
    <nav className="main-nav" aria-label="Primary">
      {destinations.map((item) => (
        <button
          key={item.route}
          className={route === item.route ? "nav-item selected" : "nav-item"}
          onClick={() => onNavigate(item.route)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function HomeScreen({ identity, onNavigate }: { identity: Identity; onNavigate: (route: MainRoute) => void }) {
  const stats = identity.kind === "user" ? identity.profile.stats : identity.guest.stats;
  const name = identity.kind === "user" ? identity.profile.username : identity.guest.displayName;

  return (
    <ArenaPage>
      <header className="hero compact-hero">
        <div className="crown-mark"><Crown size={44} /></div>
        <h1><span>QUIZ</span><span>ROYALE</span></h1>
        <p className="showdown">S H O W D O W N</p>
      </header>

      <section className="arena-card account-card">
        <div>
          <p className="eyebrow">{identity.kind === "user" ? "REGISTERED PLAYER" : "GUEST CHALLENGER"}</p>
          <h2>{name}</h2>
        </div>
        <Medal className="gold-text" size={30} />
      </section>

      {identity.kind === "guest" && (
        <button className="conversion-card" onClick={() => onNavigate("profile")}>
          <UserPlus size={22} />
          <span><strong>Make it permanent</strong><small>Keep your points, friends and rank.</small></span>
        </button>
      )}

      <div className="stat-grid">
        <Stat label="POINTS" value={stats.totalPoints} />
        <Stat label="WINS" value={stats.wins} />
        <Stat label="MATCHES" value={stats.matchesPlayed} />
        <Stat label="BEST" value={stats.bestScore} />
      </div>

      <section className="quick-actions">
        <button className="arena-card action-card gold-border" onClick={() => onNavigate("play")}>
          <Bolt size={24} /><strong>PLAY</strong><small>Choose your arena</small>
        </button>
        <button className="arena-card action-card gold-border" onClick={() => onNavigate("store")}>
          <ShoppingBag size={24} /><strong>STORE</strong><small>Power-ups & cosmetics</small>
        </button>
        <button className="arena-card action-card violet-border" onClick={() => onNavigate("season")}>
          <Sparkles size={24} /><strong>SEASON</strong><small>Progress & rewards</small>
        </button>
        <button className="arena-card action-card" onClick={() => onNavigate("profile")}>
          <UserRound size={24} /><strong>PROFILE</strong><small>Account & friends</small>
        </button>
      </section>
    </ArenaPage>
  );
}

function PlayScreen({ joiningMode, onPlay }: { joiningMode: GameMode | null; onPlay: (mode: GameMode) => void }) {
  return (
    <ArenaPage title="PLAY" subtitle="Choose your arena">
      <div className="mode-list">
        {(Object.keys(MODE_INFO) as GameMode[]).map((mode) => {
          const info = MODE_INFO[mode];
          return (
            <button key={mode} className={`mode-card ${info.accent}`} onClick={() => onPlay(mode)} disabled={joiningMode !== null}>
              <div className="mode-heading">
                {mode === "QUICK" ? <Bolt /> : mode === "TOURNAMENT" ? <Trophy /> : <Medal />}
                <span><strong>{info.title}</strong><small>{info.tagline}</small></span>
              </div>
              <p>{info.description}</p>
              <span className="enter-label">{joiningMode === mode ? "FINDING ARENA…" : "ENTER ARENA →"}</span>
            </button>
          );
        })}
      </div>
    </ArenaPage>
  );
}

function StoreScreen({ identity }: { identity: Identity }) {
  const [store, setStore] = useState<StoreItemsEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setStore(null);
    setError(null);
    loadStore(identity).then(setStore).catch((e: Error) => setError(e.message));
  }, [identity]);

  if (identity.kind === "guest") {
    return <LockedPage title="STORE" message="Register or sign in to buy power-ups, passes and cosmetics." />;
  }

  async function purchase(itemId: string) {
    setBusy(itemId);
    setError(null);
    try {
      setStore(await purchaseStoreItem(identity, itemId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Purchase failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ArenaPage title="STORE" subtitle="Power-ups, passes and cosmetics">
      {store && (
        <div className="balance-strip">
          <span>🪙 {store.balances.coins}</span><span>💎 {store.balances.gems}</span><span>🎟 {store.balances.seasonalTickets}</span>
        </div>
      )}
      {error && <InlineError>{error}</InlineError>}
      {!store && !error && <p className="muted">Loading inventory…</p>}
      <div className="item-grid">
        {store?.items.map((item) => (
          <article className="arena-card store-item" key={item.itemId}>
            <p className="eyebrow">{item.itemType}</p>
            <h3>{item.displayName}</h3>
            <p>{item.description}</p>
            <button className="primary-button" disabled={item.owned || busy !== null} onClick={() => purchase(item.itemId)}>
              {item.owned ? "OWNED" : busy === item.itemId ? "PURCHASING…" : `${item.price} ${item.currency}`}
            </button>
          </article>
        ))}
      </div>
    </ArenaPage>
  );
}

function SeasonScreen({ identity }: { identity: Identity }) {
  const [season, setSeason] = useState<CurrentSeasonEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSeason(null);
    setError(null);
    loadSeason(identity).then(setSeason).catch((e: Error) => setError(e.message));
  }, [identity]);

  if (identity.kind === "guest") {
    return <LockedPage title="SEASON" message="Register or sign in to track seasonal XP and rewards." />;
  }

  const progress = season?.progress;
  const levelProgress = progress ? (progress.xp % 1000) / 10 : 0;

  return (
    <ArenaPage title="SEASON" subtitle="Climb the current reward track">
      {error && <InlineError>{error}</InlineError>}
      {!season && !error && <p className="muted">Loading season…</p>}
      {season && (
        <>
          <section className="arena-card season-hero">
            <Sparkles className="violet-text" size={34} />
            <div><p className="eyebrow">CURRENT SEASON</p><h2>{season.season.name}</h2></div>
          </section>
          <section className="arena-card">
            <div className="season-level"><strong>LEVEL {progress?.level}</strong><span>{progress?.xp} XP</span></div>
            <div className="progress"><span style={{ width: `${levelProgress}%` }} /></div>
            <p className="muted">Tickets earned: {progress?.ticketsEarned ?? 0}</p>
          </section>
        </>
      )}
    </ArenaPage>
  );
}

function ProfileScreen({
  identity,
  onIdentity,
  onMessage,
}: {
  identity: Identity;
  onIdentity: (identity: Identity) => void;
  onMessage: (message: string | null) => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("register");
  const [busy, setBusy] = useState(false);

  if (identity.kind === "guest") {
    async function submit(event: FormEvent<HTMLFormElement>) {
      event.preventDefault();
      setBusy(true);
      onMessage(null);
      const form = new FormData(event.currentTarget);
      try {
        if (mode === "login") {
          onIdentity(await login(String(form.get("identifier") ?? ""), String(form.get("password") ?? "")));
        } else {
          onIdentity(await register(
            String(form.get("username") ?? ""),
            String(form.get("email") ?? ""),
            String(form.get("password") ?? ""),
            identity,
          ));
        }
      } catch (error) {
        onMessage(error instanceof Error ? error.message : "Authentication failed.");
      } finally {
        setBusy(false);
      }
    }

    return (
      <ArenaPage title="PROFILE" subtitle="Save your progress permanently">
        <div className="auth-switch">
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}><UserPlus size={18} /> REGISTER</button>
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}><LogIn size={18} /> SIGN IN</button>
        </div>
        <form className="arena-card auth-form" onSubmit={submit}>
          {mode === "register" ? (
            <>
              <label>Username<input name="username" autoComplete="username" required minLength={3} /></label>
              <label>Email<input name="email" type="email" autoComplete="email" required /></label>
            </>
          ) : (
            <label>Email or username<input name="identifier" autoComplete="username" required /></label>
          )}
          <label>Password<input name="password" type="password" autoComplete={mode === "register" ? "new-password" : "current-password"} required minLength={8} /></label>
          <button className="primary-button" disabled={busy}>{busy ? "PLEASE WAIT…" : mode === "register" ? "REGISTER & KEEP PROGRESS" : "SIGN IN"}</button>
        </form>
      </ArenaPage>
    );
  }

  const stats = identity.profile.stats;
  return (
    <ArenaPage title="PROFILE" subtitle={identity.profile.username}>
      <section className="arena-card profile-card">
        <UserRound size={36} className="gold-text" />
        <div><h2>{identity.profile.username}</h2><p>{identity.profile.email}</p></div>
      </section>
      <div className="stat-grid">
        <Stat label="POINTS" value={stats.totalPoints} />
        <Stat label="WINS" value={stats.wins} />
        <Stat label="CORRECT" value={stats.correctAnswers} />
        <Stat label="RANK" value={stats.bestRank ?? "—"} />
      </div>
      <section className="arena-card">
        <p className="eyebrow">FRIENDS</p>
        {identity.profile.friends.length === 0 ? <p className="muted">No friends added yet.</p> : identity.profile.friends.map((friend) => (
          <div className="friend-row" key={friend.userId}><span>{friend.username}</span><small>{friend.presence}</small></div>
        ))}
      </section>
      <button className="secondary-button" onClick={async () => onIdentity(await logout(identity))}>SIGN OUT</button>
    </ArenaPage>
  );
}

function MatchScreen({ live, socket, onExit }: { live: LiveMatch; socket: WebSocket | null; onExit: () => void }) {
  const { match, you } = live;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(interval);
  }, []);

  const seconds = Math.max(0, Math.ceil((match.phaseEndsAt - now) / 1000));
  const sortedPlayers = useMemo(() => [...match.players].sort((a, b) => b.score - a.score), [match.players]);

  function answer(index: number) {
    if (!match.question || you.answerIndex != null || socket?.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({ type: "SUBMIT_ANSWER", questionId: match.question.id, answerIndex: index }));
  }

  return (
    <div className="match-page">
      <div className="match-topbar">
        <button onClick={onExit}>← EXIT</button>
        <strong>{match.mode}</strong>
        <span>{match.phase === "FINISHED" ? "FINAL" : `${seconds}s`}</span>
      </div>
      <div className="match-content">
        <p className="eyebrow">ROUND {match.roundNumber} / {match.totalRounds}</p>
        {match.phase === "LOBBY" && <h1>Entering the arena…</h1>}
        {match.question && (
          <>
            <p className="category">{match.question.category} · {match.question.difficulty}</p>
            <h1 className="question">{match.question.text}</h1>
            <div className="answer-grid">
              {match.question.options.map((option, index) => {
                const removed = you.removedOptions.includes(index);
                const selected = you.answerIndex === index;
                const correct = match.phase === "REVEAL" && match.correctIndex === index;
                return (
                  <button
                    key={`${match.question?.id}-${index}`}
                    className={`answer ${selected ? "selected" : ""} ${correct ? "correct" : ""}`}
                    disabled={removed || you.answerIndex != null || match.phase !== "QUESTION"}
                    onClick={() => answer(index)}
                  >
                    <span>{String.fromCharCode(65 + index)}</span>{removed ? "—" : option}
                  </button>
                );
              })}
            </div>
          </>
        )}
        <section className="arena-card standings">
          <div className="season-level"><strong>STANDINGS</strong><span>{match.aliveCount} alive</span></div>
          {sortedPlayers.slice(0, 8).map((player, index) => (
            <div className={player.id === you.playerId ? "standing you" : "standing"} key={player.id}>
              <span>#{index + 1} {player.name}</span><strong>{player.score}</strong>
            </div>
          ))}
        </section>
        {match.phase === "FINISHED" && <button className="primary-button" onClick={onExit}>RETURN HOME</button>}
      </div>
    </div>
  );
}

function ArenaPage({ children, title, subtitle }: { children: ReactNode; title?: string; subtitle?: string }) {
  return (
    <div className="arena-page">
      {title && <header className="page-header"><p className="eyebrow">QUIZ ROYALE SHOWDOWN</p><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</header>}
      {children}
    </div>
  );
}

function LockedPage({ title, message }: { title: string; message: string }) {
  return <ArenaPage title={title}><section className="arena-card locked-card"><Crown size={34} /><h2>Account required</h2><p>{message}</p><small>Open PROFILE below to register or sign in.</small></section></ArenaPage>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="stat"><span>{label}</span><strong>{value}</strong></div>;
}

function InlineError({ children }: { children: ReactNode }) {
  return <div className="inline-error">{children}</div>;
}

function LoadingScreen({ message }: { message: string }) {
  return <div className="loading"><Crown size={48} /><h1>QUIZ ROYALE</h1><p>{message}</p></div>;
}
