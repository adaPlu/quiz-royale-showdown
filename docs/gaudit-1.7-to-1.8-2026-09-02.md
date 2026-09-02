# Quiz Royale 1.7 → 1.8 Graph Audit

Date: 2026-09-02  
Baseline: `main@38ff3337e18f7f2c4f1a4a3a2b233b08ab3b04db`

## Scope

The audit followed the production request path across:

- Android and web clients
- Cloudflare Worker routing
- Matchmaker and MatchRoom Durable Objects
- Railway API
- PostgreSQL
- Redis cache/coordination
- Google Play commerce
- GitHub Actions release gates

Production evidence included the last successful main release workflow and its real guest-to-WebSocket `STATE` smoke transaction. Direct shell HTTP probing was not treated as evidence because the execution container could not resolve the production host during the audit.

## Severity result

### P0

None identified.

### P1 — fixed for 1.8

1. **Matchmaking/socket-ticket abuse pressure**
   - Public matchmaking could repeatedly allocate/advance lobby buckets and mint match-room tickets without an edge rate gate.
   - Fix: distributed per-IP Durable Object limits now cover matchmaking and browser socket-ticket exchange. Practice uses the same controlled matchmaking path.

2. **Timing-sensitive HMAC string comparison**
   - Room and browser socket ticket signatures were compared as JavaScript strings.
   - Fix: signature verification now uses WebCrypto HMAC `verify` over decoded signature bytes.

## Product graph completed for 1.8

### Season lifecycle

- The Founding Season now has a real calendar window instead of a year-2100 sentinel.
- The next `Neon Circuit` season is queued in the database.
- Railway periodically reconciles the legacy `active` flag to the authoritative season time window under a PostgreSQL advisory transaction lock.
- Reads are time-window authoritative even if the scheduler is delayed.
- Future/expired season passes are hidden from the Store and cannot be purchased.
- Progress and pass ownership remain scoped by `season_id`, so rollover naturally starts a fresh progression record.

### Match-visible cosmetics

- Railway resolves equipped avatar frame, banner, title, and badge metadata with the authenticated player.
- Appearance is signed into browser socket tickets and carried through trusted Worker routing.
- MatchRoom persists appearance and publishes it in `PublicPlayer`.
- Android and web render equipped cosmetics during multiplayer instead of restricting them to profile presentation.

### Observability

Railway `/health` now safely reports:

- PostgreSQL connectivity
- Redis `connected`, `fallback`, or `not_configured`
- Google Play verification configuration
- RTDN configuration
- deploy commit prefix
- current season and end time

No credential contents are exposed.

### Google Play RTDN

- Added authenticated Pub/Sub push endpoint `POST /google-play/rtdn`.
- Google OIDC push identity is checked against configured audience and service-account email.
- Package name is checked.
- Pub/Sub message IDs are stored for idempotency without storing JWTs or purchase tokens.
- RTDN is treated only as a low-latency signal; the existing authenticated Voided Purchases reconciliation remains the financial source of truth.

## Content / polish

- Added Neon Circuit reward milestones.
- Added a Neon Circuit pass and four new cosmetic catalog entries.
- Expanded web season presentation with time remaining, pass state, XP-to-next-level, and earned/locked milestone states.

## Release gates

The 1.8 branch must not merge until all four CI lanes are green:

1. Web build + Chromium/Firefox/WebKit smoke
2. Worker tests/typecheck
3. Railway build + every migration + tests against PostgreSQL 16
4. Android unit tests

After merge, production deployment status and the main-branch release workflows must also be green before the release is considered complete.

## External production configuration

Code can be merged without exposing secrets, but full RTDN activation requires provider configuration outside GitHub:

- Pub/Sub push target: `https://railway-api-production-5772.up.railway.app/google-play/rtdn`
- Railway `GOOGLE_PLAY_RTDN_AUDIENCE` must match the OIDC audience configured for the push subscription.
- Railway `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` must match the authenticated Pub/Sub push service account.
- Google Play Console must publish Real-time Developer Notifications to the configured Pub/Sub topic.

The existing periodic Voided Purchases reconciliation remains active even if RTDN is not yet configured.

The Railway production service should also be switched from the transitional `Railway-API-Implementation` source branch to canonical `main` when the provider setting is available.
