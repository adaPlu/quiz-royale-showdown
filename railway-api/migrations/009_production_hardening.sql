-- Production hardening: season-scoped passes, refund/chargeback
-- reconciliation, and race-safe season reward grants.

CREATE TABLE IF NOT EXISTS user_season_passes (
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  season_id text NOT NULL REFERENCES seasons(season_id) ON DELETE CASCADE,
  acquired_at bigint NOT NULL,
  source text NOT NULL DEFAULT 'store',
  PRIMARY KEY (user_id, season_id)
);

-- Preserve existing Founding Season buyers before retiring the global player
-- entitlement. Reviewer/premium operational accounts continue to use
-- premiumAccess as an intentional global override.
INSERT INTO user_season_passes(user_id, season_id, acquired_at, source)
SELECT user_id, 'founding-season', COALESCE(last_login_at, created_at), 'legacy-entitlement'
FROM users
WHERE COALESCE((entitlements ->> 'seasonPassAccess')::boolean, false) = true
ON CONFLICT (user_id, season_id) DO NOTHING;

UPDATE users
SET entitlements = jsonb_set(COALESCE(entitlements, '{}'::jsonb), '{seasonPassAccess}', 'false'::jsonb, true)
WHERE COALESCE((entitlements ->> 'premiumAccess')::boolean, false) = false
  AND COALESCE((entitlements ->> 'seasonPassAccess')::boolean, false) = true;

ALTER TABLE play_purchase_receipts
  ADD COLUMN IF NOT EXISTS reversed_amount integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS voided_at bigint,
  ADD COLUMN IF NOT EXISTS voided_reason integer,
  ADD COLUMN IF NOT EXISTS voided_source integer;

CREATE TABLE IF NOT EXISTS play_purchase_voids (
  event_key text PRIMARY KEY,
  token_digest text NOT NULL REFERENCES play_purchase_receipts(token_digest) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  product_id text NOT NULL,
  voided_at bigint NOT NULL,
  voided_quantity integer,
  voided_reason integer,
  voided_source integer,
  reversed_amount integer NOT NULL DEFAULT 0,
  processed_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS play_purchase_voids_user_idx
  ON play_purchase_voids(user_id, processed_at DESC);

-- Chargebacks can create a temporary negative in-game balance. Keeping the debt
-- prevents a player from spending purchased currency before a refund and then
-- escaping the reversal; future earnings naturally pay the balance back.
ALTER TABLE currency_ledger
  DROP CONSTRAINT IF EXISTS currency_ledger_balance_after_check;

-- Re-check the idempotency ledger only after locking the user row. This closes
-- the prior race where two concurrent reward calls could both pass the first
-- EXISTS check, serialize on the user row, and then both mutate the balance.
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
  v_ledger_id text;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN false;
  END IF;
  IF p_currency NOT IN ('coins', 'gems', 'seasonalTickets') THEN
    RAISE EXCEPTION 'unsupported season reward currency %', p_currency;
  END IF;

  v_reference := p_season_id || ':level:' || p_level::text || ':' || p_tier;

  SELECT currency_balances INTO v_balances
  FROM users WHERE user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;

  IF EXISTS (
    SELECT 1 FROM currency_ledger
    WHERE user_id = p_user_id
      AND currency = p_currency
      AND reason = 'season_reward'
      AND reference_id = v_reference
  ) THEN
    RETURN false;
  END IF;

  v_balances := COALESCE(v_balances, '{}'::jsonb);
  v_current := COALESCE((v_balances ->> p_currency)::integer, 0);
  v_next := v_current + p_amount;
  v_ledger_id := 'cl-season-' || md5(p_user_id || ':' || p_currency || ':' || v_reference);

  UPDATE users
  SET currency_balances = jsonb_set(v_balances, ARRAY[p_currency], to_jsonb(v_next), true)
  WHERE user_id = p_user_id;

  INSERT INTO currency_ledger(
    ledger_id, user_id, currency, delta, balance_after, reason, reference_id, created_at
  ) VALUES (
    v_ledger_id,
    p_user_id,
    p_currency,
    p_amount,
    v_next,
    'season_reward',
    v_reference,
    (extract(epoch from clock_timestamp()) * 1000)::bigint
  );

  IF p_currency = 'seasonalTickets' THEN
    UPDATE season_progress
    SET tickets_earned = tickets_earned + p_amount
    WHERE user_id = p_user_id AND season_id = p_season_id;
  END IF;
  RETURN true;
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
  v_from := CASE WHEN TG_OP = 'INSERT' THEN 1 ELSE OLD.level + 1 END;
  IF NEW.level < v_from THEN RETURN NEW; END IF;

  SELECT
    COALESCE((u.entitlements ->> 'premiumAccess')::boolean, false)
    OR EXISTS (
      SELECT 1 FROM user_season_passes usp
      WHERE usp.user_id = NEW.user_id AND usp.season_id = NEW.season_id
    )
  INTO v_has_pass
  FROM users u
  WHERE u.user_id = NEW.user_id;

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

-- The old global-entitlement trigger is intentionally retired.
DROP TRIGGER IF EXISTS season_pass_retroactive_rewards ON users;
DROP FUNCTION IF EXISTS season_pass_retroactive_reward_trigger();

CREATE OR REPLACE FUNCTION season_pass_scoped_retroactive_reward_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_level integer;
BEGIN
  SELECT level INTO v_level
  FROM season_progress
  WHERE user_id = NEW.user_id AND season_id = NEW.season_id;

  IF v_level IS NOT NULL THEN
    PERFORM grant_season_rewards_through_level(
      NEW.user_id, NEW.season_id, 1, v_level, true
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS season_pass_scoped_retroactive_rewards ON user_season_passes;
CREATE TRIGGER season_pass_scoped_retroactive_rewards
AFTER INSERT ON user_season_passes
FOR EACH ROW EXECUTE FUNCTION season_pass_scoped_retroactive_reward_trigger();
