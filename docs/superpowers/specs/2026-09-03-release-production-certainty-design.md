# Release and Production Certainty Design

## Goal

Restore a deterministic green release baseline and remove ambiguity about which backend revision is actually serving production before new gameplay features are added.

## Scope

This tranche implements the A-series dependency root from the approved graph:

1. A1 — repair the nondeterministic Worker socket-ticket tamper test without weakening HMAC verification.
2. A2 — make `main` the canonical source of truth for Railway deployments, or, until provider source configuration can be changed, keep the transitional `Railway-API-Implementation` branch byte-equivalent to `main` and verify the active service revision.
3. A3 — verify that Google Play RTDN application configuration and Google Cloud Pub/Sub expectations agree, and add repository-side diagnostics/documentation where provider configuration cannot be read directly.

## Constraints

- Do not change UI visuals or gameplay behavior in this tranche.
- Do not weaken HMAC, authentication, CORS, billing, refund, or RTDN checks.
- Do not commit credentials, private keys, service-account JSON, Pub/Sub tokens, or Android signing secrets.
- `main` remains canonical source code.
- Changes are isolated on `repair/graph-a-release-certainty` until CI is green.
- A provider-side setting is not considered verified merely because source code expects it.

## A1 Design — deterministic tamper regression

The current test mutates only the final Base64URL character of an HMAC-SHA256 signature. For a 32-byte signature the final Base64URL symbol contains unused pad bits; changing only those unused bits can produce a different textual token that decodes to the same 32 signature bytes. WebCrypto correctly verifies those identical bytes, making the test nondeterministic.

The production verifier remains unchanged. The test will mutate a payload character inside the signed encoded payload while preserving the original signature. That guarantees the signed bytes differ and HMAC verification must fail. A second signature-tamper assertion will mutate a non-terminal signature character so decoded signature bytes necessarily change.

Success criteria:

- valid socket ticket still verifies;
- payload tampering is rejected;
- signature tampering is rejected;
- malformed/expired/room/mode mismatch coverage remains intact;
- Worker test suite and typecheck pass in PR CI.

## A2 Design — Railway source certainty

`Railway-API-Implementation` was explicitly documented as a temporary deployment branch until Railway moved to `main`. It has diverged and therefore cannot safely remain an independent production source.

Repository-side repair:

- inspect commits unique to the transitional branch before any ref movement;
- preserve any still-required change on `main` rather than retaining a divergent deployment-only fork;
- synchronize the transitional branch to the verified `main` revision only when no unique required change would be lost;
- document `main` as the required Railway source branch and `/railway.json` as the root config path.

Provider-side success criteria:

- active Railway API service source branch is `main`;
- root config path resolves to `/railway.json`;
- deployed revision reports the current `main` SHA prefix through `/health.version`;
- migration `012_pending_refund_reviews.sql` is applied;
- PostgreSQL dependency is connected and `/health` is 200;
- obsolete duplicate Railway service is removed or explicitly marked non-production.

If provider settings cannot be changed from the available connector, the repository will be made safe and the exact unresolved provider action will be reported rather than guessed.

## A3 Design — RTDN configuration certainty

The application already validates Pub/Sub OIDC identity and accepts Google Play RTDN at `/google-play/rtdn`. Repository expectations must remain explicit and testable.

Required runtime configuration:

- `GOOGLE_PLAY_PACKAGE_NAME=com.rork.quizroyaleshowdown` unless Play package migration is deliberately scheduled separately;
- `GOOGLE_PLAY_RTDN_AUDIENCE` exactly matches the Pub/Sub push audience;
- `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL` exactly matches the push authentication service account;
- Google service account used for Android Publisher API access retains required Play permissions;
- Pub/Sub push endpoint targets the canonical Railway API `/google-play/rtdn` endpoint.

Repository-side diagnostics should never expose secret values; health output may state only configured/not-configured status.

Provider-side success criteria:

- a Google test notification reaches the endpoint and receives a 2xx response;
- duplicate RTDN delivery remains idempotent;
- pending refund notification persists a review row with a 24-hour deadline;
- voided purchase notification triggers reconciliation without double reversal.

## Exit Gate

A-series is complete only when code-level CI is green and the active production backend revision/configuration is verified. Provider configuration that cannot be read from this environment remains explicitly `NEEDS_MORE_EVIDENCE` rather than being treated as complete.