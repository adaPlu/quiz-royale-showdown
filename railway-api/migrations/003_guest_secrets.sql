ALTER TABLE guests
  ADD COLUMN IF NOT EXISTS guest_secret_digest text;

