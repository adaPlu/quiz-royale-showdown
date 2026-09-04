import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import type { GameMode, MatchDifficulty, PrivateMatchResponse } from "./types";

const MODES: GameMode[] = ["QUICK", "TOURNAMENT", "PRACTICE"];
const DIFFICULTIES: MatchDifficulty[] = ["EASY", "MEDIUM", "HARD", "MIXED"];

export function PrivateMatchPanel({
  room,
  busy,
  onCreate,
  onUpdate,
  onJoin,
  onEnter,
}: {
  room: PrivateMatchResponse | null;
  busy: boolean;
  onCreate: (mode: GameMode, difficulty: MatchDifficulty) => Promise<void>;
  onUpdate: (mode: GameMode, difficulty: MatchDifficulty) => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onEnter: () => Promise<void>;
}) {
  const [mode, setMode] = useState<GameMode>(room?.mode ?? "QUICK");
  const [difficulty, setDifficulty] = useState<MatchDifficulty>(room?.difficulty ?? "MIXED");
  const [joinCode, setJoinCode] = useState("");

  async function chooseMode(next: GameMode) {
    setMode(next);
    if (room) await onUpdate(next, difficulty);
  }

  async function chooseDifficulty(next: MatchDifficulty) {
    setDifficulty(next);
    if (room) await onUpdate(mode, next);
  }

  return (
    <section className="arena-card" aria-labelledby="private-match-title">
      <div className="mode-heading">
        <LockKeyhole aria-hidden="true" />
        <span><strong id="private-match-title">PRIVATE MATCH</strong><small>Create a room or join with a six-character code.</small></span>
      </div>

      <p className="eyebrow">MODE</p>
      <div className="auth-switch" role="group" aria-label="Private match mode">
        {MODES.map((candidate) => (
          <button
            key={candidate}
            className={candidate === mode ? "active" : ""}
            disabled={busy}
            aria-label={`Select private mode ${candidate.toLowerCase()}`}
            aria-pressed={candidate === mode}
            onClick={() => void chooseMode(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>

      <p className="eyebrow">DIFFICULTY</p>
      <div className="auth-switch" role="group" aria-label="Private match difficulty">
        {DIFFICULTIES.map((candidate) => (
          <button
            key={candidate}
            className={candidate === difficulty ? "active" : ""}
            disabled={busy}
            aria-label={`Select private difficulty ${candidate.toLowerCase()}`}
            aria-pressed={candidate === difficulty}
            onClick={() => void chooseDifficulty(candidate)}
          >
            {candidate}
          </button>
        ))}
      </div>

      {room ? (
        <div className="arena-card account-card" role="status" aria-live="polite">
          <div><p className="eyebrow">ROOM CODE</p><h2>{room.code}</h2><small>{room.mode} · {room.difficulty}</small></div>
          <button className="primary-button" disabled={busy} onClick={() => void onEnter()}>{busy ? "ENTERING…" : "ENTER PRIVATE ARENA"}</button>
        </div>
      ) : (
        <>
          <button className="primary-button" disabled={busy} onClick={() => void onCreate(mode, difficulty)}>{busy ? "CREATING…" : "CREATE PRIVATE ROOM"}</button>
          <form className="auth-form" onSubmit={(event) => { event.preventDefault(); if (joinCode.length === 6) void onJoin(joinCode); }}>
            <label>Room code<input value={joinCode} onChange={(event) => setJoinCode(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))} placeholder="AB2CD3" minLength={6} maxLength={6} required /></label>
            <button className="secondary-button" disabled={busy || joinCode.length !== 6}>JOIN BY CODE</button>
          </form>
        </>
      )}
    </section>
  );
}
