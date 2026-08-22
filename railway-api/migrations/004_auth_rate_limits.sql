CREATE TABLE IF NOT EXISTS auth_rate_limits (
  rate_key text PRIMARY KEY,
  count integer NOT NULL,
  reset_at bigint NOT NULL,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_reset_idx
  ON auth_rate_limits(reset_at);
