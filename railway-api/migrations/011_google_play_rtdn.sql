-- 011_google_play_rtdn.sql
-- Idempotency/audit trail for authenticated Google Cloud Pub/Sub push messages.
-- Purchase tokens and JWTs are intentionally never stored here.

CREATE TABLE IF NOT EXISTS play_rtdn_events (
  message_id text PRIMARY KEY,
  package_name text NOT NULL,
  event_kind text NOT NULL,
  event_time bigint,
  received_at bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS play_rtdn_events_received_idx
  ON play_rtdn_events(received_at DESC);
