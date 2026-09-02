-- 010_season_lifecycle_content.sql
-- Give seasons real calendar windows and queue the next season so the server can
-- roll forward without a deployment at the boundary.

UPDATE seasons
SET starts_at = 1785542400000, -- 2026-08-01T00:00:00Z
    ends_at = 1790812800000    -- 2026-10-01T00:00:00Z
WHERE season_id = 'founding-season'
  AND ends_at >= 4102444800000;

INSERT INTO seasons(season_id, name, starts_at, ends_at, reward_track, active, created_at)
VALUES (
  'neon-circuit',
  'Neon Circuit',
  1790812800000, -- 2026-10-01T00:00:00Z
  1798761600000, -- 2027-01-01T00:00:00Z
  '[
    {"level":2,"coins":150},
    {"level":3,"seasonalTickets":2},
    {"level":4,"gems":5},
    {"level":5,"coins":250,"premium":true},
    {"level":6,"seasonalTickets":3},
    {"level":8,"gems":8},
    {"level":10,"coins":500,"premium":true},
    {"level":12,"gems":15}
  ]'::jsonb,
  false,
  1790812800000
)
ON CONFLICT (season_id) DO UPDATE SET
  name = EXCLUDED.name,
  starts_at = EXCLUDED.starts_at,
  ends_at = EXCLUDED.ends_at,
  reward_track = EXCLUDED.reward_track;

INSERT INTO cosmetic_items(cosmetic_id, cosmetic_type, display_name, rarity, payload, sort_order)
VALUES
  ('frame-neon-violet', 'avatar_frame', 'Neon Violet Frame', 'rare',
   '{"accent":"violet","matchLabel":"NEON"}'::jsonb, 60),
  ('banner-neon-circuit', 'banner', 'Neon Circuit Banner', 'rare',
   '{"theme":"neon-circuit","matchLabel":"CIRCUIT"}'::jsonb, 70),
  ('title-circuit-breaker', 'title', 'Circuit Breaker', 'epic',
   '{"title":"Circuit Breaker"}'::jsonb, 80),
  ('badge-perfect-run', 'badge', 'Perfect Run', 'epic',
   '{"label":"ACE"}'::jsonb, 90)
ON CONFLICT (cosmetic_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  rarity = EXCLUDED.rarity,
  payload = EXCLUDED.payload,
  active = true,
  sort_order = EXCLUDED.sort_order;

INSERT INTO store_items(item_id, item_type, display_name, description, currency, price, payload, sort_order)
VALUES
  ('season-pass-neon-circuit', 'SEASON_PASS', 'Neon Circuit Pass',
   'Unlocks premium rewards for the Neon Circuit season.', 'gems', 90,
   '{"seasonId":"neon-circuit"}'::jsonb, 100),
  ('cosmetic-frame-neon-violet', 'COSMETIC', 'Neon Violet Frame',
   'A violet arena frame visible on your profile and in live matches.', 'coins', 350,
   '{"cosmeticId":"frame-neon-violet"}'::jsonb, 110),
  ('cosmetic-banner-neon-circuit', 'COSMETIC', 'Neon Circuit Banner',
   'A Neon Circuit banner visible on your profile and in live matches.', 'coins', 600,
   '{"cosmeticId":"banner-neon-circuit"}'::jsonb, 120),
  ('cosmetic-title-circuit-breaker', 'COSMETIC', 'Circuit Breaker',
   'An epic title shown beside your name in live matches.', 'gems', 35,
   '{"cosmeticId":"title-circuit-breaker"}'::jsonb, 130),
  ('cosmetic-badge-perfect-run', 'COSMETIC', 'Perfect Run Badge',
   'An epic ACE badge shown in live-match standings.', 'gems', 45,
   '{"cosmeticId":"badge-perfect-run"}'::jsonb, 140)
ON CONFLICT (item_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  description = EXCLUDED.description,
  currency = EXCLUDED.currency,
  price = EXCLUDED.price,
  payload = EXCLUDED.payload,
  active = true,
  sort_order = EXCLUDED.sort_order;
