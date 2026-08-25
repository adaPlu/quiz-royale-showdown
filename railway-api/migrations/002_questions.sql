CREATE TABLE IF NOT EXISTS questions (
  question_id text PRIMARY KEY,
  category text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  text text NOT NULL,
  options jsonb NOT NULL,
  correct_index integer NOT NULL CHECK (correct_index >= 0 AND correct_index < 4),
  content_hash text NOT NULL UNIQUE,
  source text NOT NULL CHECK (source IN ('import', 'openai', 'static')),
  status text NOT NULL CHECK (status IN ('active', 'pending_review', 'rejected')),
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS questions_active_bucket_idx
  ON questions(category, difficulty, updated_at)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS question_usage_events (
  match_id text NOT NULL,
  round_number integer NOT NULL CHECK (round_number > 0),
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  mode text NOT NULL,
  category text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  asked_at bigint NOT NULL,
  PRIMARY KEY (match_id, round_number, question_id)
);

CREATE INDEX IF NOT EXISTS question_usage_events_bucket_time_idx
  ON question_usage_events(category, difficulty, asked_at DESC);

CREATE TABLE IF NOT EXISTS question_usage_rollups (
  window_name text NOT NULL,
  category text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  question_id text NOT NULL REFERENCES questions(question_id) ON DELETE CASCADE,
  asked_count integer NOT NULL CHECK (asked_count >= 0),
  window_started_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  PRIMARY KEY (window_name, category, difficulty, question_id, window_started_at)
);

CREATE INDEX IF NOT EXISTS question_usage_rollups_bucket_window_idx
  ON question_usage_rollups(category, difficulty, window_name, window_started_at DESC);

CREATE TABLE IF NOT EXISTS question_generation_jobs (
  job_id text PRIMARY KEY,
  category text NOT NULL,
  difficulty text NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  requested_count integer NOT NULL CHECK (requested_count > 0),
  status text NOT NULL CHECK (status IN ('running', 'completed', 'failed', 'skipped')),
  reason text NOT NULL,
  error text,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS question_generation_jobs_active_idx
  ON question_generation_jobs(category, difficulty, status, updated_at);
