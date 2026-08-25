CREATE TABLE IF NOT EXISTS friend_invites (
  invite_id text PRIMARY KEY,
  from_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  to_user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'canceled')),
  created_at bigint NOT NULL,
  responded_at bigint,
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS friend_invites_to_status_idx
  ON friend_invites(to_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS friend_invites_from_status_idx
  ON friend_invites(from_user_id, status, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS friend_invites_pending_pair_idx
  ON friend_invites(from_user_id, to_user_id)
  WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS seasons (
  season_id text PRIMARY KEY,
  name text NOT NULL,
  starts_at bigint NOT NULL,
  ends_at bigint NOT NULL,
  reward_track jsonb NOT NULL DEFAULT '[]'::jsonb,
  active boolean NOT NULL DEFAULT false,
  created_at bigint NOT NULL,
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS seasons_one_active_idx
  ON seasons(active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS season_progress (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  season_id text NOT NULL REFERENCES seasons(season_id) ON DELETE CASCADE,
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  level integer NOT NULL DEFAULT 1 CHECK (level >= 1),
  tickets_earned integer NOT NULL DEFAULT 0 CHECK (tickets_earned >= 0),
  updated_at bigint NOT NULL,
  PRIMARY KEY (user_id, season_id)
);

CREATE TABLE IF NOT EXISTS currency_ledger (
  ledger_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  currency text NOT NULL CHECK (currency IN ('coins', 'gems', 'seasonalTickets')),
  delta integer NOT NULL CHECK (delta <> 0),
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  reason text NOT NULL,
  reference_id text NOT NULL,
  created_at bigint NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS currency_ledger_reference_idx
  ON currency_ledger(user_id, currency, reason, reference_id);

CREATE TABLE IF NOT EXISTS cosmetic_items (
  cosmetic_id text PRIMARY KEY,
  cosmetic_type text NOT NULL CHECK (cosmetic_type IN ('avatar_frame', 'banner', 'title', 'badge')),
  display_name text NOT NULL,
  rarity text NOT NULL CHECK (rarity IN ('common', 'rare', 'epic', 'legendary')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS store_items (
  item_id text PRIMARY KEY,
  item_type text NOT NULL CHECK (item_type IN ('POWERUP_CHARGE', 'COSMETIC', 'SEASON_PASS')),
  display_name text NOT NULL,
  description text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('coins', 'gems', 'seasonalTickets')),
  price integer NOT NULL CHECK (price >= 0),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS store_items_active_idx
  ON store_items(active, sort_order, item_id);

CREATE TABLE IF NOT EXISTS player_cosmetics (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  cosmetic_id text NOT NULL REFERENCES cosmetic_items(cosmetic_id) ON DELETE CASCADE,
  source text NOT NULL,
  acquired_at bigint NOT NULL,
  PRIMARY KEY (user_id, cosmetic_id)
);

CREATE TABLE IF NOT EXISTS equipped_cosmetics (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  cosmetic_type text NOT NULL CHECK (cosmetic_type IN ('avatar_frame', 'banner', 'title', 'badge')),
  cosmetic_id text NOT NULL REFERENCES cosmetic_items(cosmetic_id) ON DELETE CASCADE,
  equipped_at bigint NOT NULL,
  PRIMARY KEY (user_id, cosmetic_type)
);

CREATE TABLE IF NOT EXISTS store_purchases (
  purchase_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES store_items(item_id),
  idempotency_key text NOT NULL,
  currency text NOT NULL CHECK (currency IN ('coins', 'gems', 'seasonalTickets')),
  price integer NOT NULL CHECK (price >= 0),
  purchased_at bigint NOT NULL,
  UNIQUE (user_id, idempotency_key)
);

INSERT INTO seasons(season_id, name, starts_at, ends_at, reward_track, active, created_at)
VALUES (
  'founding-season',
  'Founding Season',
  0,
  4102444800000,
  '[{"level":2,"coins":100},{"level":3,"seasonalTickets":2},{"level":5,"gems":10}]'::jsonb,
  true,
  0
)
ON CONFLICT (season_id) DO NOTHING;

INSERT INTO cosmetic_items(cosmetic_id, cosmetic_type, display_name, rarity, payload, sort_order)
VALUES
  ('frame-neon-cyan', 'avatar_frame', 'Neon Cyan Frame', 'common', '{"accent":"cyan"}'::jsonb, 10),
  ('frame-royal-gold', 'avatar_frame', 'Royal Gold Frame', 'rare', '{"accent":"gold"}'::jsonb, 20),
  ('banner-night-arena', 'banner', 'Night Arena Banner', 'common', '{"theme":"night-arena"}'::jsonb, 30),
  ('title-early-challenger', 'title', 'Early Challenger', 'common', '{"title":"Early Challenger"}'::jsonb, 40)
ON CONFLICT (cosmetic_id) DO NOTHING;

INSERT INTO store_items(item_id, item_type, display_name, description, currency, price, payload, sort_order)
VALUES
  ('powerup-pack-small', 'POWERUP_CHARGE', 'Small Power-Up Pack', 'Adds 3 power-up charges.', 'coins', 150, '{"charges":3}'::jsonb, 10),
  ('powerup-pack-large', 'POWERUP_CHARGE', 'Large Power-Up Pack', 'Adds 10 power-up charges.', 'gems', 20, '{"charges":10}'::jsonb, 20),
  ('cosmetic-frame-neon-cyan', 'COSMETIC', 'Neon Cyan Frame', 'Unlocks the Neon Cyan avatar frame.', 'coins', 300, '{"cosmeticId":"frame-neon-cyan"}'::jsonb, 30),
  ('cosmetic-frame-royal-gold', 'COSMETIC', 'Royal Gold Frame', 'Unlocks the Royal Gold avatar frame.', 'gems', 40, '{"cosmeticId":"frame-royal-gold"}'::jsonb, 40),
  ('cosmetic-banner-night-arena', 'COSMETIC', 'Night Arena Banner', 'Unlocks the Night Arena profile banner.', 'coins', 500, '{"cosmeticId":"banner-night-arena"}'::jsonb, 50),
  ('season-pass-founding', 'SEASON_PASS', 'Founding Season Pass', 'Unlocks premium rewards for the Founding Season.', 'gems', 100, '{"seasonId":"founding-season"}'::jsonb, 60)
ON CONFLICT (item_id) DO NOTHING;
