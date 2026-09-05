-- Bounded economy reporting reads recent aggregate activity by ledger timestamp
-- and store purchase timestamp. These indexes keep internal telemetry queries
-- from degrading into full-table scans as live-ops history grows.

CREATE INDEX IF NOT EXISTS currency_ledger_created_currency_reason_idx
  ON currency_ledger(created_at DESC, currency, reason);

CREATE INDEX IF NOT EXISTS store_purchases_purchased_currency_idx
  ON store_purchases(purchased_at DESC, currency);
