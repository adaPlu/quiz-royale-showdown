ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player',
  ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS currency_balances jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS users_role_idx ON users(role);
