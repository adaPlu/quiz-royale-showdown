# Quiz Royale Showdown

Quiz Royale Showdown is a cross-platform, real-time multiplayer trivia battle royale with persistent progression, cosmetics, seasons, power-ups, virtual currency, social features, and optional Google Play Billing purchases.

The canonical integration and production source branch is `main`.

## Project links

- Repository: `https://github.com/adaPlu/quiz-royale-showdown`
- Web app: `https://quiz-royale-showdown.pages.dev`
- Google Play package: `com.rork.quizroyaleshowdown`
- Railway production API: `https://railway-api-production-5772.up.railway.app`
- Cloudflare multiplayer Worker: `https://quiz-royale-functions.adapluguez.workers.dev`

## Current Android release

```text
applicationId: com.rork.quizroyaleshowdown
versionName:   2.0
versionCode:   1787428691
minSdk:        26
targetSdk:     36
compileSdk:    37
```

The canonical signed 2.0 workflow builds and verifies both APK and AAB artifacts using the configured upload keystore and verifies the approved signing certificate before artifact publication.

## Application stack

- Android: Kotlin, Jetpack Compose, Material 3, Ktor, Koin, Coil, Google Play Billing
- Web: React, TypeScript, Vite, Playwright
- API: Node.js, TypeScript, PostgreSQL, Redis, Zod
- Multiplayer: Cloudflare Workers, Durable Objects, WebSockets
- Infrastructure: Railway, PostgreSQL, Redis, Cloudflare Pages/Workers, GitHub Actions

## Core features

### Multiplayer

- Quick, Tournament, and Practice modes
- Cloudflare Durable Object match rooms
- Server-authoritative live state
- Signed room and browser-safe socket tickets
- Timed rounds, scoring, streaks, lives, placement, and standings
- Reconnect and join-timeout handling
- Android/web protocol support

### Accounts and progression

- Registered accounts and guest sessions
- Guest heartbeat/expiry and guest-to-account registration
- Persistent sessions and server-side authorization
- XP, player statistics, coins, gems, seasonal tickets, and season progression

### Store and economy

- Server-authoritative Store catalog
- Power-up, season-pass, and cosmetic purchases
- Cosmetic ownership/equip state
- Google Play Billing coin/gem packs
- Server-side Play receipt verification
- Idempotent currency grants and purchase consumption
- Periodic Voided Purchases reconciliation
- Authenticated Google Play RTDN ingestion

Current Google Play product IDs:

```text
quiz_coins_500
quiz_coins_1200
quiz_gems_50
quiz_gems_140
```

Localized real-money pricing is supplied by Google Play rather than hard-coded by the app.

### Seasons and cosmetics

- Free and premium season milestones
- Retroactive premium rewards after season-pass purchase
- Avatar frames, banners, titles, and badges
- Android ownership flow: `LOCKED -> UNLOCK -> OWNED -> EQUIP -> EQUIPPED`

### Social

- Friend search and invitations
- Accept / decline / cancel invitation
- Friend removal
- Profiles and leaderboards

## High-level architecture

```text
Android App -----------+
                       |
                       v
                 Railway API -------- PostgreSQL
                       |              Redis
                       |
Web App ---------------+
                       |
                       v
             Cloudflare Worker
                 Durable Objects
                 WebSocket rooms
```

Persistent identity, progression, and economy operations are handled by Railway/PostgreSQL. Low-latency multiplayer state is handled by Cloudflare Workers and Durable Objects. Clients are not authoritative for match results, economy mutations, or ownership.

## Google Play paid-currency trust flow

```text
Google Play checkout
        |
        v
Android purchase callback
        |
        v
Railway verifies purchase with Google Play
        |
        v
Database transaction
  - replay check
  - balance grant
  - receipt record
  - ledger record
        |
        v
Railway consumes purchase
        |
        v
Client refreshes balance
```

The Android client never directly credits paid currency from a Billing callback.

Production billing accepts `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` or `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64`. The production package remains `com.rork.quizroyaleshowdown`.

## RTDN and operational alert status

Repository implementation and the provider connection are in place:

- authenticated Google Play RTDN Pub/Sub push is configured to the Railway `/google-play/rtdn` endpoint;
- a Google-originated RTDN test notification has returned HTTP 200 and been persisted;
- operational webhook alerting is configured and a bounded test alert has been accepted by the configured receiver.

The remaining commerce certification gate is a real Play-distributed license-tester purchase followed by refund/void lifecycle verification and idempotency confirmation.

## Development

### Railway API

```bash
npm ci --prefix railway-api
npm run build --prefix railway-api
npm run migrate --prefix railway-api
npm test --prefix railway-api
npm start --prefix railway-api
```

### Cloudflare Worker

```bash
npm ci --prefix functions
npm test --prefix functions
cd functions && npx wrangler dev
```

### Web

```bash
npm install --prefix webapp
npm run build --prefix webapp
npm run typecheck --prefix webapp
npm run test:e2e --prefix webapp
```

### Android

```bash
cd android-quiz-royale-showdown
./gradlew :app:testDebugUnitTest --stacktrace
```

Release builds require explicit production endpoint configuration:

```env
EXPO_PUBLIC_RAILWAY_API_URL=https://railway-api-production-5772.up.railway.app
EXPO_PUBLIC_RORK_FUNCTIONS_URL=https://quiz-royale-functions.adapluguez.workers.dev
```

## CI and release workflows

Primary validation is `.github/workflows/ui-web-test.yml`, covering:

- Android unit tests;
- Railway API build, migrations, and tests;
- Worker tests/type validation;
- web production build and Playwright smoke coverage.

CodeQL covers Java/Kotlin and JavaScript/TypeScript. Production web release is gated through the reusable validation and CodeQL workflows.

Android 2.0 release-related workflows are synchronized to `versionName 2.0` and `versionCode 1787428691`, including the signed release workflow and auxiliary diagnostic APK/AAB workflows.

Railway production tracks `main`. Railway GitHub check-suite gating must be enabled so production deployment cannot outrun required GitHub checks.

## Production release checklist

Before broad Play rollout, verify:

- [x] Android 2.0 source metadata is `2.0 / 1787428691`
- [x] Signed APK/AAB workflow succeeds
- [x] APK/AAB signing certificate verification succeeds
- [x] Android, Railway, Worker, web, and CodeQL validation passes for the 2.0 release branch
- [x] Railway production API is healthy
- [x] Authenticated RTDN test delivery reaches production and persists
- [x] Operational alert receiver accepts the bounded certification alert
- [ ] Railway GitHub check-suite deployment gating enabled
- [ ] Main branch protection/governance verified
- [ ] Play license-tester purchase completes end to end
- [ ] Duplicate purchase submission does not double-credit
- [ ] Refund/void lifecycle and reconciliation verified in production
- [ ] Final `/Gaudit` completed after release-governance changes
- [ ] 2.0 AAB passes Play Console checks and is promoted to the intended track

## Known follow-on work

The remaining release-critical work is operational rather than missing core architecture: CI/deployment governance, live Play commerce/refund/void certification, final release audit, and Play rollout.

Non-blocking follow-on polish includes deeper multiplayer/commerce soak testing, more bespoke cosmetic artwork/animation, and continued economy, season-content, and trivia-quality tuning.

Do not rename the Android `applicationId` casually. The existing Google Play application is `com.rork.quizroyaleshowdown`; changing it would normally create a different Play app identity rather than update the current listing.

## Security and secret handling

Never commit production credentials, service-account JSON, tokens, keystores, upload-key passwords, or `.env` files. Economy and identity remain server-authoritative, purchase tokens are verified server-side, and paid grants are recorded transactionally for replay protection.

## Branch strategy

```text
main
  |
  v
focused feature/repair branch
  |
  v
validation + review
  |
  v
PR to main
```

Do not merge historical temporary audit/build/deployment-probe branches merely because they still exist.

## License

Copyright © 2026 Adam Pluguez. All rights reserved unless otherwise specified by the repository owner.
