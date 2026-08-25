CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  user_id text PRIMARY KEY,
  username text NOT NULL,
  username_lower text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at bigint NOT NULL,
  last_login_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_digest text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS sessions_user_id_idx ON sessions(user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  token_digest text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  expires_at bigint NOT NULL,
  created_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS password_reset_tokens_user_id_idx ON password_reset_tokens(user_id);
CREATE INDEX IF NOT EXISTS password_reset_tokens_expires_at_idx ON password_reset_tokens(expires_at);

CREATE SEQUENCE IF NOT EXISTS guest_slot_seq START WITH 1000;

CREATE TABLE IF NOT EXISTS free_guest_slots (
  slot integer PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS guests (
  guest_id text PRIMARY KEY,
  slot integer NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at bigint NOT NULL,
  last_seen_at bigint NOT NULL,
  expires_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS guests_expires_at_idx ON guests(expires_at);

CREATE TABLE IF NOT EXISTS player_stats (
  subject_kind text NOT NULL CHECK (subject_kind IN ('USER', 'GUEST')),
  subject_id text NOT NULL,
  stats jsonb NOT NULL,
  display_name text NOT NULL,
  expires_at bigint,
  updated_at bigint NOT NULL,
  PRIMARY KEY (subject_kind, subject_id)
);

CREATE INDEX IF NOT EXISTS player_stats_subject_id_idx ON player_stats(subject_id);
CREATE INDEX IF NOT EXISTS player_stats_guest_expiry_idx ON player_stats(expires_at) WHERE subject_kind = 'GUEST';

CREATE TABLE IF NOT EXISTS leaderboard_entries (
  subject_kind text NOT NULL CHECK (subject_kind IN ('USER', 'GUEST')),
  subject_id text NOT NULL,
  display_name text NOT NULL,
  total_points integer NOT NULL,
  wins integer NOT NULL,
  losses integer NOT NULL,
  category_points jsonb NOT NULL,
  expires_at bigint,
  updated_at bigint NOT NULL,
  PRIMARY KEY (subject_kind, subject_id)
);

CREATE INDEX IF NOT EXISTS leaderboard_world_idx
  ON leaderboard_entries(total_points DESC, wins DESC, updated_at ASC);
CREATE INDEX IF NOT EXISTS leaderboard_guest_expiry_idx
  ON leaderboard_entries(expires_at) WHERE subject_kind = 'GUEST';

CREATE TABLE IF NOT EXISTS match_reports (
  match_id text NOT NULL,
  subject_kind text NOT NULL CHECK (subject_kind IN ('USER', 'GUEST')),
  subject_id text NOT NULL,
  reported_at bigint NOT NULL,
  PRIMARY KEY (match_id, subject_kind, subject_id)
);

CREATE INDEX IF NOT EXISTS match_reports_subject_idx
  ON match_reports(subject_kind, subject_id);

CREATE TABLE IF NOT EXISTS friendships (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  friend_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  added_at bigint NOT NULL,
  PRIMARY KEY (user_id, friend_user_id),
  CHECK (user_id <> friend_user_id)
);

CREATE INDEX IF NOT EXISTS friendships_friend_idx ON friendships(friend_user_id);

CREATE TABLE IF NOT EXISTS presence (
  user_id text PRIMARY KEY REFERENCES users(user_id) ON DELETE CASCADE,
  last_seen_at bigint NOT NULL,
  status text NOT NULL CHECK (status IN ('IDLE', 'IN_MATCH')),
  match_mode text,
  status_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS powerup_inventory (
  subject_kind text NOT NULL CHECK (subject_kind IN ('USER', 'GUEST')),
  subject_id text NOT NULL,
  powerup_type text NOT NULL,
  charges integer NOT NULL CHECK (charges >= 0),
  updated_at bigint NOT NULL,
  PRIMARY KEY (subject_kind, subject_id, powerup_type)
);
