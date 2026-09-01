# Quiz Royale Feature Inventory

## Implemented

- Registered accounts, secure sessions, logout, and password reset.
- Temporary guest sessions with authenticated guest secrets and guest-to-account stat transfer.
- Quick, Tournament, and solo Practice modes over server-authoritative WebSockets.
- Practice is non-competitive: it does not persist leaderboard points, currency, season XP, placements, badges, or power-up rewards.
- Global/category leaderboards.
- Friend search, invitations, accept/decline/cancel, removal, and friends-only presence.
- 50:50, Shield, and Double Down power-ups with persistent charge inventory.
- Coins, gems, and seasonal tickets.
- Server-authoritative virtual-currency Store.
- Cosmetic catalog, ownership, equip state, and Android profile appearance.
- Season progression with free and premium milestone rewards.
- Season passes scoped to a specific season.
- Google Play Billing coin/gem packs with account-bound server verification, idempotent grants, and Play consumption.
- Periodic Google Play Voided Purchases reconciliation for refunds/chargebacks, including quantity-based partial refunds.
- Refund debt is preserved as a negative balance so future earnings repay reversed currency instead of erasing the chargeback.
- Protected internal billing diagnostics and manual voided-purchase reconciliation endpoint.
- Google Play reviewer account provisioning only when a strong explicit reviewer password is configured.

## Remaining Product/Operations Work

- Automated season rollover/scheduling and administration beyond the current Founding Season.
- Real-time Developer Notifications (RTDN) as an optional low-latency complement to the implemented Voided Purchases polling reconciler.
- Broader multiplayer/load/adversarial commerce testing.
- More production-quality cosmetic artwork and match-visible cosmetic presentation.
- Broader observability and alerting.

## Reviewer Account

- Reviewer email: `google-reviewer@quizroyale.gg`.
- Reviewer username: `google_reviewer`.
- Reviewer role: `google_play_reviewer`.
- Reviewer password must be supplied only through the deployment secret `GOOGLE_PLAY_REVIEW_PASSWORD`.
- Placeholder, example, or short reviewer passwords are rejected by the server.
- Never place the reviewer password in Git, documentation, screenshots, issues, or chat logs.
