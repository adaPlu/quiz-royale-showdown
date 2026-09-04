# Quiz Royale Railway API

Postgres-backed REST API for persistent Quiz Royale identity, guest sessions,
friends, stats, powerups, password reset, leaderboards, commerce, and Google
Play real-time developer notifications (RTDN).

## Production source contract

`main` is the canonical production source branch. Railway should use the repo
root with `/railway.json`; `Railway-API-Implementation` is transitional only
and must not carry independent production code.

A production deployment is not considered verified until `GET /health`
returns HTTP 200 and its `version` field matches the deployed `main` commit
SHA prefix. The health payload must also report PostgreSQL as `connected`.

## Environment

- `DATABASE_URL`: Railway Postgres connection string.
- `INTERNAL_API_TOKEN`: shared secret required for all Worker/internal API calls.
- `GOOGLE_PLAY_REVIEW_PASSWORD`: explicit password used to provision the Google Play reviewer account.
- `GOOGLE_PLAY_PACKAGE_NAME`: Play package name; defaults to `com.rork.quizroyaleshowdown`.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`: preferred Railway-safe Android Publisher service-account credential. Never commit this value.
- `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`: optional raw JSON fallback when Base64 is not used. Never commit this value.
- `GOOGLE_PLAY_RTDN_AUDIENCE`: exact expected audience on authenticated Pub/Sub push OIDC tokens.
- `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`: exact service-account email allowed to push RTDN events.
- `GOOGLE_PLAY_VOIDED_RECONCILIATION`: set to `false` only to deliberately disable periodic voided-purchase reconciliation.
- `GOOGLE_PLAY_VOIDED_RECONCILE_INTERVAL_MS`: optional reconciliation interval override; minimum one minute.
- `GOOGLE_PLAY_REFUND_REVIEW_ALERTS`: set to `false` only to deliberately disable pending-refund deadline checks.
- `GOOGLE_PLAY_REFUND_REVIEW_ALERT_INTERVAL_MS`: optional pending-refund alert interval override; minimum one minute.
- `PGSSL`: set to `disable` only for local databases that do not support TLS.
- `PGSSL_REJECT_UNAUTHORIZED`: set to `false` only when a managed database requires TLS without trusted certificate validation.
- `PASSWORD_RESET_EMAIL_ENDPOINT`: optional email-provider webhook endpoint.
- `PASSWORD_RESET_EMAIL_TOKEN`: optional bearer token for the email endpoint.
- `PASSWORD_RESET_BASE_URL`: optional deep link / reset URL base.
- `CORS_ORIGIN`: optional CORS origin.

## RTDN production contract

Google Cloud Pub/Sub push delivery must target:

```text
https://<canonical-railway-api-host>/google-play/rtdn
```

Push authentication must be enabled. The Pub/Sub OIDC audience must exactly
match `GOOGLE_PLAY_RTDN_AUDIENCE`, and its service account must exactly match
`GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`.

The API rejects RTDN when those variables are absent. For configured pushes it
validates the Google token audience, service-account email, `email_verified`,
issuer, and expiration before accepting the message. Runtime health reports
only whether RTDN is configured; it never returns the secret credential.

Provider verification requires a Google test notification to receive a 2xx
response. A repository-only check cannot prove Pub/Sub settings, so provider
configuration must remain marked `NEEDS_MORE_EVIDENCE` until tested directly.

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

Railway deploys run migrations before server startup through root
`railway.json`: `npm run migrate --prefix railway-api && npm start --prefix
railway-api`. Run manual migrations only after the target Railway service has
the correct `DATABASE_URL`. The migration runner first performs a read-only
public-schema inspection and refuses to mutate databases with unknown tables,
unless `ALLOW_UNKNOWN_SCHEMA=true` or `ALLOW_UNMANAGED_APP_SCHEMA=true` is set
after manual review.

Migration `012_pending_refund_reviews.sql` must be present in production before
pending refund-review RTDN handling is considered deployed.
