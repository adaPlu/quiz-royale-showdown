# Quiz Royale Railway API

Postgres-backed REST API for persistent Quiz Royale identity, guest sessions,
friends, stats, powerups, password reset, and leaderboards.

## Environment

- `DATABASE_URL`: Railway Postgres connection string.
- `INTERNAL_API_TOKEN`: shared secret required for all Worker/internal API calls.
- `GOOGLE_PLAY_REVIEW_PASSWORD`: explicit password used to provision the Google Play reviewer account.
- `PGSSL`: set to `disable` only for local databases that do not support TLS.
- `PGSSL_REJECT_UNAUTHORIZED`: set to `false` only when a managed database requires TLS without trusted certificate validation.
- `PASSWORD_RESET_EMAIL_ENDPOINT`: optional email-provider webhook endpoint.
- `PASSWORD_RESET_EMAIL_TOKEN`: optional bearer token for the email endpoint.
- `PASSWORD_RESET_BASE_URL`: optional deep link / reset URL base.
- `CORS_ORIGIN`: optional CORS origin, defaults to `*`.

## Commands

- `npm run build`
- `npm run migrate`
- `npm run import:questions`
- `npm test`
- `npm start`

## API Notes

Persistent routes mirror the Android contract for auth, guests, friends,
presence, and leaderboards. `GET /powerups` returns the current
`powerup_inventory` for an authenticated user, or for a live guest when called
with `?guestId=...`.

Question imports read from `QUESTION_SOURCE_DATABASE_URL` and only write to the
current app `DATABASE_URL`. `QUESTION_SOURCE_PGSSL=disable` is available only
for source databases that do not support TLS.

Railway deploys run migrations before server startup through `railway.json`:
`npm run migrate --prefix railway-api && npm start --prefix railway-api`. Run
manual migrations only after the target Railway service has the correct
`DATABASE_URL`. The migration runner first performs a read-only public-schema
inspection and refuses to mutate databases with unknown tables, unless
`ALLOW_UNKNOWN_SCHEMA=true` or `ALLOW_UNMANAGED_APP_SCHEMA=true` is set after
manual review.
