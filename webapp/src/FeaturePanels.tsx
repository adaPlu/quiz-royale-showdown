import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Search, ShieldCheck, Sparkles, Trophy, UserMinus, UserPlus, X } from "lucide-react";
import {
  equipCosmetic,
  loadCosmetics,
  loadFriendInvites,
  loadLeaderboard,
  loadLeaderboardBoards,
  refreshIdentity,
  removeFriend,
  respondFriendInvite,
  searchUsers,
  sendFriendInvite,
} from "./api";
import type {
  CosmeticItem,
  FriendInvitesEnvelope,
  Identity,
  LeaderboardPage,
  UserSearchResult,
} from "./types";
import "./feature-panels.css";

export function LeaderboardPanel({ identity }: { identity: Identity }) {
  const [boards, setBoards] = useState<string[]>(["WORLD"]);
  const [board, setBoard] = useState("WORLD");
  const [page, setPage] = useState<LeaderboardPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadLeaderboardBoards().then((next) => {
      if (next.length > 0) setBoards(next);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    setPage(null);
    setError(null);
    loadLeaderboard(board, identity).then(setPage).catch((e: Error) => setError(e.message));
  }, [board, identity]);

  return (
    <section className="arena-card feature-panel" aria-labelledby="leaderboard-title">
      <div className="feature-heading">
        <div><p className="eyebrow">COMPETITION</p><h2 id="leaderboard-title">Leaderboard</h2></div>
        <Trophy className="gold-text" aria-hidden="true" />
      </div>
      <label className="compact-field">Board
        <select value={board} onChange={(event) => setBoard(event.target.value)}>
          {boards.map((name) => <option key={name} value={name}>{name}</option>)}
        </select>
      </label>
      {page && <p className="muted">Your rank: {page.yourRank ?? "—"} · {page.yourPoints} pts · {page.totalRanked} ranked</p>}
      {error && <p className="panel-error" role="alert">{error}</p>}
      {!page && !error && <p className="muted" aria-live="polite">Loading standings…</p>}
      <div className="leaderboard-list">
        {page?.entries.slice(0, 10).map((entry) => (
          <div className={entry.isYou ? "leaderboard-row you" : "leaderboard-row"} key={`${entry.subjectKind}-${entry.subjectId}`}>
            <span><strong>#{entry.rank}</strong> {entry.displayName}</span>
            <span>{entry.points} pts · {entry.wins} wins</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function FriendsPanel({ identity, onIdentity }: { identity: Identity; onIdentity: (identity: Identity) => void }) {
  const [invites, setInvites] = useState<FriendInvitesEnvelope>({ incoming: [], outgoing: [] });
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const friends = identity.kind === "user" ? identity.profile.friends : [];
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.userId)), [friends]);

  async function refreshAll() {
    if (identity.kind !== "user") return;
    const [nextInvites, nextIdentity] = await Promise.all([
      loadFriendInvites(identity),
      refreshIdentity(identity),
    ]);
    setInvites(nextInvites);
    onIdentity(nextIdentity);
  }

  useEffect(() => {
    if (identity.kind !== "user") return;
    loadFriendInvites(identity).then(setInvites).catch((e: Error) => setError(e.message));
  }, [identity.kind, identity.kind === "user" ? identity.token : "guest"]);

  if (identity.kind !== "user") return null;

  async function submitSearch(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setBusy("search");
    setError(null);
    try {
      setResults(await searchUsers(identity, query));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setBusy(null);
    }
  }

  async function invite(username: string) {
    setBusy(`invite:${username}`);
    setError(null);
    try {
      setInvites(await sendFriendInvite(identity, username));
      setResults((current) => current.filter((result) => result.username !== username));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invite failed.");
    } finally {
      setBusy(null);
    }
  }

  async function respond(inviteId: string, action: "accept" | "decline" | "cancel") {
    setBusy(inviteId);
    setError(null);
    try {
      setInvites(await respondFriendInvite(identity, inviteId, action));
      await refreshAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update invite.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    setBusy(`remove:${userId}`);
    setError(null);
    try {
      const profile = await removeFriend(identity, userId);
      onIdentity({ kind: "user", token: identity.token, profile });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove friend.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="arena-card feature-panel" aria-labelledby="friends-title">
      <div className="feature-heading">
        <div><p className="eyebrow">SOCIAL</p><h2 id="friends-title">Friends</h2></div>
        <UserPlus className="gold-text" aria-hidden="true" />
      </div>

      <form className="friend-search" onSubmit={submitSearch} role="search">
        <label className="sr-only" htmlFor="friend-search-input">Find player by username</label>
        <input id="friend-search-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find player by username" minLength={2} />
        <button className="icon-button" aria-label="Search players" disabled={busy === "search"}><Search size={18} /></button>
      </form>

      {error && <p className="panel-error" role="alert">{error}</p>}

      {results.length > 0 && (
        <div className="panel-section">
          <p className="eyebrow">SEARCH RESULTS</p>
          {results.map((result) => (
            <div className="social-row" key={result.userId}>
              <span>{result.username}</span>
              {friendIds.has(result.userId) ? <small>Already friends</small> : (
                <button className="small-button" onClick={() => invite(result.username)} disabled={busy !== null}>INVITE</button>
              )}
            </div>
          ))}
        </div>
      )}

      {invites.incoming.length > 0 && (
        <div className="panel-section">
          <p className="eyebrow">INCOMING</p>
          {invites.incoming.map((inviteItem) => (
            <div className="social-row" key={inviteItem.inviteId}>
              <span>{inviteItem.username}</span>
              <span className="row-actions">
                <button className="icon-button success" aria-label={`Accept ${inviteItem.username}`} onClick={() => respond(inviteItem.inviteId, "accept")} disabled={busy !== null}><Check size={17} /></button>
                <button className="icon-button" aria-label={`Decline ${inviteItem.username}`} onClick={() => respond(inviteItem.inviteId, "decline")} disabled={busy !== null}><X size={17} /></button>
              </span>
            </div>
          ))}
        </div>
      )}

      {invites.outgoing.length > 0 && (
        <div className="panel-section">
          <p className="eyebrow">SENT</p>
          {invites.outgoing.map((inviteItem) => (
            <div className="social-row" key={inviteItem.inviteId}>
              <span>{inviteItem.username}</span>
              <button className="small-button" onClick={() => respond(inviteItem.inviteId, "cancel")} disabled={busy !== null}>CANCEL</button>
            </div>
          ))}
        </div>
      )}

      <div className="panel-section">
        <p className="eyebrow">YOUR FRIENDS</p>
        {friends.length === 0 ? <p className="muted">No friends added yet.</p> : friends.map((friend) => (
          <div className="social-row" key={friend.userId}>
            <span><strong>{friend.username}</strong><small className={`presence ${friend.presence.toLowerCase()}`}>{friend.presence}{friend.matchMode ? ` · ${friend.matchMode}` : ""}</small></span>
            <button className="icon-button danger" aria-label={`Remove ${friend.username}`} onClick={() => remove(friend.userId)} disabled={busy !== null}><UserMinus size={17} /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

export function CosmeticsPanel({ identity }: { identity: Identity }) {
  const [cosmetics, setCosmetics] = useState<CosmeticItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (identity.kind !== "user") return;
    loadCosmetics(identity).then(setCosmetics).catch((e: Error) => setError(e.message));
  }, [identity]);

  if (identity.kind !== "user") return null;

  async function equip(cosmeticId: string) {
    setBusy(cosmeticId);
    setError(null);
    try {
      setCosmetics(await equipCosmetic(identity, cosmeticId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not equip cosmetic.");
    } finally {
      setBusy(null);
    }
  }

  const owned = cosmetics.filter((item) => item.owned);
  return (
    <section className="feature-panel" aria-labelledby="cosmetics-title">
      <div className="feature-heading">
        <div><p className="eyebrow">COLLECTION</p><h2 id="cosmetics-title">Cosmetics</h2></div>
        <Sparkles className="violet-text" aria-hidden="true" />
      </div>
      {error && <p className="panel-error" role="alert">{error}</p>}
      {cosmetics.length === 0 && !error && <p className="muted">No cosmetics unlocked yet.</p>}
      <div className="cosmetic-grid">
        {cosmetics.map((item) => (
          <article className={item.equipped ? "arena-card cosmetic-card equipped" : "arena-card cosmetic-card"} key={item.cosmeticId}>
            <ShieldCheck size={22} aria-hidden="true" />
            <div><p className="eyebrow">{item.rarity} · {item.cosmeticType}</p><h3>{item.displayName}</h3></div>
            <button className="small-button" disabled={!item.owned || item.equipped || busy !== null} onClick={() => equip(item.cosmeticId)}>
              {!item.owned ? "LOCKED" : item.equipped ? "EQUIPPED" : busy === item.cosmeticId ? "EQUIPPING…" : "EQUIP"}
            </button>
          </article>
        ))}
      </div>
      {owned.length > 0 && <p className="muted">Owned {owned.length} / {cosmetics.length}</p>}
    </section>
  );
}
