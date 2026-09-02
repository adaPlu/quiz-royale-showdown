-- 012_pending_refund_reviews.sql
CREATE TABLE IF NOT EXISTS play_pending_refund_reviews (
  pending_refund_token text PRIMARY KEY,
  review_id text NOT NULL UNIQUE,
  order_id text NOT NULL,
  refund_reason integer,
  obfuscated_account_id text,
  obfuscated_profile_id text,
  event_time bigint,
  received_at bigint NOT NULL,
  deadline_at bigint NOT NULL,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'SUBMITTING', 'FAILED', 'COMPLETED')),
  decision text CHECK (decision IS NULL OR decision IN ('APPROVE', 'DECLINE', 'NEUTRAL')),
  sample_content_provided boolean,
  consumption_percentage_milliunits integer CHECK (consumption_percentage_milliunits IS NULL OR consumption_percentage_milliunits BETWEEN 0 AND 100000),
  consumption_usage_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  submit_attempts integer NOT NULL DEFAULT 0 CHECK (submit_attempts >= 0),
  google_status integer,
  google_response jsonb,
  last_attempt_at bigint,
  completed_at bigint,
  last_alert_at bigint,
  updated_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS play_pending_refund_reviews_open_deadline_idx
  ON play_pending_refund_reviews(deadline_at ASC)
  WHERE status <> 'COMPLETED';

CREATE INDEX IF NOT EXISTS play_pending_refund_reviews_order_idx
  ON play_pending_refund_reviews(order_id);
