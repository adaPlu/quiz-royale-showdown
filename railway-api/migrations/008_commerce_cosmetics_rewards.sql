-- Commerce/cosmetic repair: make every seeded cosmetic obtainable, add paid
-- currency product/receipt tables, and make configured season milestone rewards
-- server-authoritative and idempotent.

INSERT INTO store_items(item_id, item_type, display_name, description, currency, price, payload, sort_order)
VALUES
  ('cosmetic-title-early-challenger', 'COSMETIC', 'Early Challenger', 'Unlocks the Early Challenger profile title.', 'coins', 250, '{"cosmeticId":"title-early-challenger"}'::jsonb, 55)
ON CONFLICT (item_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  currency = EXCLUDED.currency,
  price = EXCLUDED.price,
  payload = EXCLUDED.payload,
  active = true,
  sort_order = EXCLUDED.sort_order;

-- A small starter paid-currency catalog. Prices remain entirely in Google Play
-- so localized price/currency are never hard-coded in our backend or client.
CREATE TABLE IF NOT EXISTS paid_currency_products (
  product_id text PRIMARY KEY,
  currency text NOT NULL CHECK (currency IN ('coins', 'gems')),
  amount integer NOT NULL CHECK (amount > 0),
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0
);

INSERT INTO paid_currency_products(product_id, currency, amount, sort_order)
VALUES
  ('quiz_coins_500', 'coins', 500, 10),
  ('quiz_coins_1200', 'coins', 1200, 20),
  ('quiz_gems_50', 'gems', 50, 30),
  ('quiz_gems_140', 'gems', 140, 40)
ON CONFLICT (product_id) DO UPDATE SET
  currency = EXCLUDED.currency,
  amount = EXCLUDED.amount,
  active = true,
  sort_order = EXCLUDED.sort_order;

CREATE TABLE IF NOT EXISTS play_purchase_receipts (
  token_digest text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  product_id text NOT NULL REFERENCES paid_currency_products(product_id),
  order_id text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  currency text NOT NULL CHECK (currency IN ('coins', 'gems')),
  amount_per_unit integer NOT NULL CHECK (amount_per_unit > 0),
  granted_amount integer NOT NULL CHECK (granted_amount > 0),
  purchase_time bigint,
  verified_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS play_purchase_receipts_user_idx
  ON play_purchase_receipts(user_id, verified_at DESC);

-- Add explicit premium milestones so the existing Founding Season Pass has a
-- concrete benefit instead of advertising a reward tier that does not exist.
UPDATE seasons
SET reward_track = '[
  {"level":2,"coins":100},
  {"level":3,"seasonalTickets":2},
  {"level":4,"gems":5,"premium":true},
  {"level":5,"gems":10},
  {"level":6,"coins":300,"premium":true}
]'::jsonb
WHERE season_id = 'founding-season';

CREATE OR REPLACE FUNCTION grant_season_currency_reward(
  p_user_id text,
  p_season_id text,
  p_level integer,
  p_tier text,
  p_currency text,
  p_amount integer
) RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  v_balances jsonb;
  v_current integer;
  v_next integer;
  v_reference text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN false;
  END IF;
  IF p_currency NOT IN ('coins', 'gems', 'seasonalTickets') THEN
    RAISE EXCEPTION 'unsupported season reward currency %', p_currency;
  END IF;

  v_reference := p_season_id || ':level:' || p_level::text || ':' || p_tier;
  IF EXISTS (
    SELECT 1 FROM currency_ledger
    WHERE user_id = p_user_id
      AND currency = p_currency
      AND reason = 'season_reward'
      AND reference_id = v_reference
  ) THEN
    RETURN false;
  END IF;

  SELECT currency_balances INTO v_balances
  FROM users WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  v_balances := COALESCE(v_balances, '{}'::jsonb);
  v_current := COALESCE((v_balances ->> p_currency)::integer, 0);
  v_next := v_current + p_amount;

  UPDATE users
  SET currency_balances = jsonb_set(v_balances, ARRAY[p_currency], to_jsonb(v_next), true)
  WHERE user_id = p_user_id;

  INSERT INTO currency_ledger(
    ledger_id, user_id, currency, delta, balance_after, reason, reference_id, created_at
  ) VALUES (
    'cl-' || gen_random_uuid()::text,
    p_user_id,
    p_currency,
    p_amount,
    v_next,
    'season_reward',
    v_reference,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  ) ON CONFLICT DO NOTHING;

  IF p_currency = 'seasonalTickets' THEN
    UPDATE season_progress
    SET tickets_earned = tickets_earned + p_amount
    WHERE user_id = p_user_id AND season_id = p_season_id;
  END IF;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION grant_season_rewards_through_level(
  p_user_id text,
  p_season_id text,
  p_from_level integer,
  p_to_level integer,
  p_include_premium boolean
) RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_reward jsonb;
  v_level integer;
  v_premium boolean;
  v_tier text;
BEGIN
  IF p_to_level <= p_from_level THEN RETURN; END IF;

  FOR v_reward IN
    SELECT value FROM jsonb_array_elements(
      COALESCE((SELECT reward_track FROM seasons WHERE season_id = p_season_id), '[]'::jsonb)
    )
  LOOP
    v_level := COALESCE((v_reward ->> 'level')::integer, 0);
    v_premium := COALESCE((v_reward ->> 'premium')::boolean, false);
    IF v_level <= p_from_level OR v_level > p_to_level THEN CONTINUE; END IF;
    IF v_premium AND NOT p_include_premium THEN CONTINUE; END IF;
    v_tier := CASE WHEN v_premium THEN 'premium' ELSE 'free' END;

    PERFORM grant_season_currency_reward(p_user_id, p_season_id, v_level, v_tier || ':coins', 'coins', COALESCE((v_reward ->> 'coins')::integer, 0));
    PERFORM grant_season_currency_reward(p_user_id, p_season_id, v_level, v_tier || ':gems', 'gems', COALESCE((v_reward ->> 'gems')::integer, 0));
    PERFORM grant_season_currency_reward(p_user_id, p_season_id, v_level, v_tier || ':tickets', 'seasonalTickets', COALESCE((v_reward ->> 'seasonalTickets')::integer, 0));
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION season_progress_reward_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_from integer;
  v_has_pass boolean;
BEGIN
  v_from := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.level END;
  IF NEW.level <= v_from THEN RETURN NEW; END IF;
  SELECT COALESCE((entitlements ->> 'seasonPassAccess')::boolean, false)
    INTO v_has_pass FROM users WHERE user_id = NEW.user_id;
  PERFORM grant_season_rewards_through_level(
    NEW.user_id, NEW.season_id, v_from, NEW.level, COALESCE(v_has_pass, false)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS season_progress_rewards ON season_progress;
CREATE TRIGGER season_progress_rewards
AFTER INSERT OR UPDATE OF level ON season_progress
FOR EACH ROW EXECUTE FUNCTION season_progress_reward_trigger();

-- If a player buys the pass after reaching premium milestones, grant all
-- eligible premium rewards retroactively. Ledger uniqueness keeps retries safe.
CREATE OR REPLACE FUNCTION season_pass_retroactive_reward_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old boolean;
  v_new boolean;
  v_progress record;
BEGIN
  v_old := COALESCE((OLD.entitlements ->> 'seasonPassAccess')::boolean, false);
  v_new := COALESCE((NEW.entitlements ->> 'seasonPassAccess')::boolean, false);
  IF v_old OR NOT v_new THEN RETURN NEW; END IF;

  FOR v_progress IN
    SELECT sp.season_id, sp.level
    FROM season_progress sp
    JOIN seasons s ON s.season_id = sp.season_id
    WHERE sp.user_id = NEW.user_id AND s.active = true
  LOOP
    PERFORM grant_season_rewards_through_level(
      NEW.user_id, v_progress.season_id, 1, v_progress.level, true
    );
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS season_pass_retroactive_rewards ON users;
CREATE TRIGGER season_pass_retroactive_rewards
AFTER UPDATE OF entitlements ON users
FOR EACH ROW EXECUTE FUNCTION season_pass_retroactive_reward_trigger();
