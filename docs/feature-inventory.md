# Quiz Royale Feature Inventory

## Implemented

- Registered accounts, secure sessions, logout, and password reset.
- Temporary guest sessions with authenticated guest secrets and guest-to-account stat transfer.
- Quick, Tournament, and solo Practice modes over server-authoritative WebSockets.
- Distributed edge abuse limits for matchmaking and browser socket-ticket exchange.
- WebCrypto-verified HMAC room/socket tickets.
- Practice is non-competitive: it does not persist leaderboard points, currency, season XP, placements, badges, or power-up rewards.
- Global/category leaderboards with Redis caching and PostgreSQL fallback.
- Friend search, invitations, accept/decline/cancel, removal, and friends-only presence.
- 50:50, Shield, and Double Down power-ups with persistent charge inventory.
- Coins, gems, and seasonal tickets.
- Server-authoritative virtual-currency Store.
- Cosmetic catalog, ownership, equip state, profile appearance, and match-visible equipped cosmetics on Android/web.
- Season progression with free and premium milestone rewards.
- Season passes scoped to a specific season.
- Calendar-driven season lifecycle with automatic rollover reconciliation.
- Founding Season followed by the queued Neon Circuit season.
- Google Play Billing coin/gem packs with account-bound server verification, idempotent grants, and Play consumption.
- Periodic Google Play Voided Purchases reconciliation for refunds/chargebacks, including quantity-based partial refunds.
- Authenticated Google Play RTDN Pub/Sub push ingestion as a low-latency signal for purchase-lifecycle reconciliation.
- Refund debt is preserved as a negative balance so future earnings repay reversed currency instead of erasing the chargeback.
- Protected internal billing diagnostics and manual voided-purchase reconciliation endpoint.
- Safe production health reporting for PostgreSQL, Redis fallback state, billing configuration, RTDN configuration, deploy version, and active season.
- Google Play reviewer account provisioning only when a strong explicit reviewer password is configured.
- Cross-client private-room verification covering host create/update/enter, join-by-code, fresh room assignments/tickets, guest credential propagation, and Android assignment parity.
- Bounded private-match soak/adversarial coverage: 20,000 room metadata round trips, 25,000 difficulty mapping iterations, malformed room rejection, and commerce/refund invariants.
- Subtle cosmetic presentation motion using the existing Arena palette and layout, including a `prefers-reduced-motion` fallback.
- Railway production services are sourced from canonical `main`.
- Bounded operational failure-rate detection with category windows, cooldowns, and HTTPS webhook delivery support.

## Remaining Product/Operations Work

- Configure the Google Play / Pub/Sub provider side of RTDN and matching Railway audience/service-account variables.
- Expand the bespoke production cosmetic artwork/content set.
- Configure `OPS_ALERT_WEBHOOK_URL` in Railway to activate external API, matchmaking, database, and commerce alert delivery.
- Ongoing economy balancing, seasonal content, and trivia-content quality review.

## Operational Alerting

- `OPS_ALERT_WEBHOOK_URL`: HTTPS destination that receives JSON operational alerts. Leave unset to keep delivery disabled.
- `OPS_ALERT_FAILURE_THRESHOLD`: failures required inside one category window before delivery; defaults to `5`.
- `OPS_ALERT_WINDOW_MS`: rolling failure-rate window; defaults to `60000`.
- `OPS_ALERT_COOLDOWN_MS`: per-category delivery cooldown; defaults to `300000`.
- Alert payloads contain only service/category/count/timing/status summaries and deployment metadata; request bodies, authorization headers, guest secrets, and provider credentials are never included.

## Reviewer Account

- Reviewer email: `google-reviewer@quizroyale.gg`.
- Reviewer username: `google_reviewer`.
- Reviewer role: `google_play_reviewer`.
- Reviewer password must be supplied only through the deployment secret `GOOGLE_PLAY_REVIEW_PASSWORD`.
- Placeholder, example, or short reviewer passwords are rejected by the server.
- Never place the reviewer password in Git, documentation, screenshots, issues, or chat logs.
