# Quiz Royale Showdown

Quiz Royale Showdown is a cross-platform, real-time multiplayer trivia battle royale built around fast quiz rounds, persistent progression, social features, cosmetics, seasons, power-ups, virtual currency, and server-authoritative multiplayer.

The current application consists of:

- a native Android client built with Kotlin and Jetpack Compose;
- a React + TypeScript + Vite web client;
- a Railway-hosted Node.js/TypeScript API;
- PostgreSQL for persistent game/account/economy data;
- Redis for caching and coordination;
- Cloudflare Workers + Durable Objects for low-latency matchmaking and live WebSocket game rooms;
- Google Play Billing for optional Android coin and gem purchases.

The canonical integration and production source branch is `main`.

---

## Project Links

- Repository: `https://github.com/adaPlu/quiz-royale-showdown`
- Web app: `https://quiz-royale-showdown.pages.dev`
- Google Play package: `com.rork.quizroyaleshowdown`
- Railway production API: `https://railway-api-production-5772.up.railway.app`
- Cloudflare multiplayer Worker: `https://quiz-royale-functions.adapluguez.workers.dev`

A custom production web origin may also be deployed through the prepared Cloudflare Pages release workflow.

---

## Current Android Version

```text
applicationId: com.rork.quizroyaleshowdown
versionName:   1.8
versionCode:   1787428687
minSdk:        26
targetSdk:     36
compileSdk:    36
```

---

# Features

## Multiplayer

- Real-time trivia matches over WebSockets
- Cloudflare Durable Object match rooms
- Quick, Tournament, and Practice modes
- Signed room tickets
- Browser-safe short-lived socket tickets
- Server-authoritative game state
- Timed rounds
- Answer submission and reveal
- Score, streak, lives, placement, and standings
- Reconnect handling
- Match join timeout/watchdog behavior
- Keyboard answer controls on web
- Cross-platform Android/web protocol support

## Accounts and Sessions

- Registered accounts
- Guest sessions
- Guest session heartbeat and expiry handling
- Guest-to-account registration flow
- Persistent registered sessions
- Player identity validation on protected routes
- Server-side authorization

## Player Progression

- XP and player statistics
- Match rewards
- Persistent virtual currency balances
- Coins
- Gems
- Seasonal tickets
- Seasonal progression
- Free and premium season milestones
- Retroactive premium rewards after purchasing a season pass

## Store and Economy

- Server-authoritative Store catalog
- Power-up purchases
- Season pass purchases
- Cosmetic unlocks
- Cosmetic ownership
- Cosmetic equip state
- Match-visible equipped frames, banners, titles, and badges
- Paid Android currency packs through Google Play Billing
- Server-side Google Play receipt verification
- Idempotent paid-currency grants
- Server-side Play consumption after entitlement grant
- Periodic Voided Purchases reconciliation
- Authenticated Google Play RTDN Pub/Sub ingestion for low-latency lifecycle signals

## Cosmetics

Current cosmetic support includes ownership/equip handling for profile presentation types such as:

- avatar frames;
- banners;
- titles;
- badges.

The Android Store implements a full progression flow:

```text
LOCKED -> UNLOCK -> OWNED -> EQUIP -> EQUIPPED
```

Equipped cosmetics are also represented on the Android profile UI.

## Social

- Friend search
- Friend invitations
- Accept / decline / cancel invitation
- Friend removal
- Player profiles
- Leaderboards

## Web Client

The browser client provides persistent navigation across:

```text
HOME / PLAY / STORE / SEASON / PROFILE
```

It supports:

- registered and guest identities;
- matchmaking;
- live multiplayer;
- Store;
- cosmetics;
- seasons;
- leaderboards;
- friends;
- responsive desktop/mobile layouts;
- accessibility improvements;
- reduced-motion handling;
- loading/error states;
- optional telemetry hooks.

---

# High-Level Architecture

```text
                       +----------------------+
                       |      Android App     |
                       | Kotlin / Jetpack     |
                       | Compose / Billing    |
                       +----------+-----------+
                                  |
                                  | HTTPS
                                  |
               +------------------+------------------+
               |                                     |
               v                                     v
     +--------------------+                +--------------------+
     |    Railway API     |                | Cloudflare Worker  |
     | Node / TypeScript  |                | Matchmaking/Auth   |
     +---------+----------+                +----------+---------+
               |                                      |
         +-----+-----+                                |
         |           |                                v
         v           v                     +--------------------+
   +-----------+ +---------+                | Durable Objects    |
   |PostgreSQL | |  Redis  |                | Live match rooms   |
   +-----------+ +---------+                +--------------------+


                       +----------------------+
                       |       Web App        |
                       | React / TS / Vite    |
                       +----------+-----------+
                                  |
                         HTTPS / WebSocket
                                  |
                      Railway + Cloudflare
```

The architecture intentionally separates persistent account/economy operations from low-latency multiplayer state.

---

# Repository Structure

```text
quiz-royale-showdown/
|
|-- .github/
|   `-- workflows/
|       |-- ui-web-test.yml
|       |-- deploy-web-pages.yml
|       `-- release-web-production.yml
|
|-- android-quiz-royale-showdown/
|   |-- app/
|   |   `-- src/main/java/com/rork/quizroyaleshowdown/
|   |       |-- data/
|   |       `-- ui/
|   |-- gradle/
|   `-- gradlew / gradlew.bat
|
|-- functions/
|   |-- index.ts
|   |-- match-room.ts
|   |-- matchmaker.ts
|   |-- room-ticket.ts
|   |-- cors-policy.ts
|   |-- tests
|   `-- wrangler.toml
|
|-- railway-api/
|   |-- migrations/
|   |-- src/
|   |   |-- app.ts
|   |   |-- server.ts
|   |   |-- commerce.ts
|   |   |-- identity.ts
|   |   |-- db.ts
|   |   `-- tests
|   `-- package.json
|
|-- webapp/
|   |-- src/
|   |-- tests/
|   |-- playwright.config.ts
|   |-- vite.config.ts
|   `-- package.json
|
|-- docs/
|-- railway.json
|-- rork.json
|-- package.json
`-- README.md
```

---

# Technology Stack

## Android

- Kotlin
- Jetpack Compose
- Material 3
- Android Navigation Compose
- Ktor client
- Kotlin serialization
- Coil
- Koin
- AndroidX Security Crypto
- Google Play Billing Library

## Web

- React
- TypeScript
- Vite
- Playwright
- Lucide React

## Railway API

- Node.js
- TypeScript
- PostgreSQL (`pg`)
- Redis
- Zod
- REST APIs

## Multiplayer

- Cloudflare Workers
- Durable Objects
- WebSockets
- Wrangler

## Infrastructure

- Railway
- PostgreSQL
- Redis
- Cloudflare Pages
- Cloudflare Workers
- GitHub Actions
- Google Play Console / Android Publisher API

---

# Gameplay Flow

```text
Player
  |
  v
Choose mode
  |
  v
Matchmaking
  |
  v
Receive room assignment + signed room ticket
  |
  v
Join Durable Object match room
  |
  v
Receive authoritative STATE
  |
  v
Question round
  |
  +--> answer submitted
  |      |
  |      v
  |   reveal / score / standings
  |      |
  +------+
  |
  v
Match complete
  |
  v
Railway persists rewards / stats / progression
```

The client is never considered authoritative for match results, economy mutations, or account ownership.

---

# Question System

Production trivia questions are stored in PostgreSQL in the existing `QuestionBank` source of truth.

Questions support:

- categories;
- easy / medium / hard difficulty;
- multiple answer choices;
- correct-answer tracking;
- active/inactive state;
- usage metadata.

The Railway API supplies question sets to the multiplayer system rather than relying on a client-side question bank.

---

# Authentication and Identity

Quiz Royale supports registered users and guest identities.

Important security rules:

1. Clients do not get to declare arbitrary authoritative player identities.
2. Protected Railway routes authenticate the current account server-side.
3. Multiplayer joins use server-issued room/socket tickets.
4. Economy and Store mutations are executed by the backend.
5. Secrets are deployment configuration and must never be committed to Git.

---

# Store, Currency, and Google Play Billing

Quiz Royale has three persistent virtual currencies:

```text
coins
gems
seasonalTickets
```

Coins and gems can be earned in gameplay and can also be used for Store purchases.

Android additionally supports optional real-money Google Play purchases for coin/gem packs.

## Current Google Play Product IDs

```text
quiz_coins_500   -> 500 coins
quiz_coins_1200  -> 1200 coins
quiz_gems_50     -> 50 gems
quiz_gems_140    -> 140 gems
```

The application intentionally does not hard-code real-money prices. Google Play supplies localized pricing through Billing.

## Paid Currency Trust Flow

```text
Google Play checkout
       |
       v
Account-bound Play purchase
       |
       v
Android sends purchase token to Railway
       |
       v
Railway verifies purchase with Google Play
       |
       +--> purchase state
       +--> product ID
       +--> Quiz Royale account binding
       |
       v
Database transaction
       |
       +--> replay/duplicate check
       +--> balance update
       +--> receipt record
       +--> currency ledger record
       |
       v
Railway consumes Play purchase
       |
       v
Client refreshes balances
```

The Android client does **not** directly grant coins or gems after a Billing callback.

## Railway Billing Configuration

Production Railway billing verification accepts either:

```env
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=
```

or:

```env
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64=
```

Optional package override:

```env
GOOGLE_PLAY_PACKAGE_NAME=com.rork.quizroyaleshowdown
```

If no override is provided, the backend defaults to `com.rork.quizroyaleshowdown`.

Before real-money transactions can work, the four products must exist and be active in Google Play Console and the Railway service account must have Android Publisher access.

---

# Seasons

The season system supports:

- active season metadata;
- per-player season progress;
- normal level progression;
- seasonal tickets;
- milestone rewards;
- free rewards;
- premium rewards;
- season-pass entitlement;
- retroactive premium reward grants.

Season milestone grants are server-authoritative and recorded through the currency ledger so retries do not intentionally duplicate rewards.

---

# Cosmetics

Cosmetics are stored separately from Store SKUs so ownership/equip state can be managed independently of pricing.

A cosmetic Store SKU unlocks its cosmetic ID. After ownership is established, the player can equip it.

The current migration also ensures the `Early Challenger` title has an obtainable Store SKU.

Production-quality unique cosmetic artwork remains an area for continued visual polish; the application already has the ownership/equip/presentation plumbing required to support those assets.

---

# Local Development

## Prerequisites

Recommended local tools:

- Git
- Node.js 22+
- npm
- JDK 17 for CI parity
- Android Studio
- Android SDK
- PostgreSQL 16+
- Redis
- Wrangler

Install Wrangler globally only if desired:

```bash
npm install -g wrangler
```

Using the project-local Wrangler dependency through `npx` is also supported.

---

## Clone

```bash
git clone https://github.com/adaPlu/quiz-royale-showdown.git
cd quiz-royale-showdown
git switch main
```

If your existing clone still references the former repository name, update it with:

```bash
git remote set-url origin https://github.com/adaPlu/quiz-royale-showdown.git
git fetch origin --prune
```

---

# Railway API Development

Install dependencies:

```bash
npm ci --prefix railway-api
```

Build:

```bash
npm run build --prefix railway-api
```

Apply migrations after building:

```bash
npm run migrate --prefix railway-api
```

Run tests:

```bash
npm test --prefix railway-api
```

Start the compiled API:

```bash
npm start --prefix railway-api
```

Typical development environment variables include:

```env
DATABASE_URL=
REDIS_URL=
PORT=3000
NODE_ENV=development
```

Production may additionally require authentication/internal-service and billing configuration.

---

# Cloudflare Worker Development

Install dependencies:

```bash
npm ci --prefix functions
```

Run Worker tests and TypeScript validation:

```bash
npm test --prefix functions
```

Run locally:

```bash
cd functions
npx wrangler dev
```

Deploy manually when correctly authenticated:

```bash
cd functions
npm run deploy
```

Do not overwrite production dashboard secrets/vars unintentionally.

---

# Web Development

Install:

```bash
npm install --prefix webapp
```

Run development server:

```bash
npm run dev --prefix webapp
```

Production build:

```bash
npm run build --prefix webapp
```

Typecheck:

```bash
npm run typecheck --prefix webapp
```

Install Playwright browsers:

```bash
cd webapp
npx playwright install --with-deps chromium firefox webkit
```

Run browser smoke tests:

```bash
npm run test:e2e --prefix webapp
```

---

# Android Development

Open:

```text
android-quiz-royale-showdown/
```

in Android Studio and let Gradle sync.

## Unit Tests

macOS/Linux:

```bash
cd android-quiz-royale-showdown
./gradlew :app:testDebugUnitTest --stacktrace
```

Windows PowerShell:

```powershell
cd android-quiz-royale-showdown
.\gradlew.bat :app:testDebugUnitTest --stacktrace
```

## Release Endpoint Configuration

Release builds require the production endpoints to be explicitly supplied through Gradle properties or environment variables:

```env
EXPO_PUBLIC_RAILWAY_API_URL=https://railway-api-production-5772.up.railway.app
EXPO_PUBLIC_RORK_FUNCTIONS_URL=https://quiz-royale-functions.adapluguez.workers.dev
```

Debug builds fall back to those current production URLs when values are omitted; release builds intentionally require explicit configuration.

---

# Database Migrations

Migrations live in:

```text
railway-api/migrations/
```

The CI pipeline boots PostgreSQL 16 and applies **all migrations** before Railway tests.

Important migration responsibilities include:

- authentication and user data;
- social systems;
- Store and inventory;
- seasons and rewards;
- paid currency products;
- Google Play receipt records;
- cosmetic catalog repairs.

Do not edit an already-applied production migration casually. Prefer a new forward migration for production schema evolution.

---

# Automated Testing

The primary workflow is:

```text
.github/workflows/ui-web-test.yml
```

It contains four verification lanes.

## 1. Web

- dependency install;
- TypeScript/Vite production build;
- Playwright browser installation;
- Chromium smoke tests;
- Firefox smoke tests;
- WebKit smoke tests.

## 2. Worker

- Worker dependency install;
- Node test suite;
- TypeScript validation.

## 3. Railway + PostgreSQL

- PostgreSQL 16 service container;
- Railway dependency install;
- TypeScript build;
- complete migration application;
- Railway API tests.

## 4. Android

- JDK setup;
- Gradle setup;
- Android debug unit tests.

This matrix should be green before integrating gameplay, commerce, authentication, or deployment changes.

---

# Production Web Release Workflow

The repository contains:

```text
.github/workflows/release-web-production.yml
```

It is intentionally manual (`workflow_dispatch`) and coordinates the web multiplayer release.

Its production sequence is:

```text
validate credentials
      |
      +--> configure Railway CORS
      |
      +--> deploy Cloudflare Worker
      |       `--> verify /websocket-ticket
      |
      +--> build/deploy Cloudflare Pages
      |       `--> attach play.quizroyale.gg
      |
      `--> live production sanity
              |-- Railway health/CORS
              |-- Worker health/CORS
              |-- guest creation
              |-- registration/auth
              |-- Store
              |-- cosmetics
              |-- season
              |-- leaderboard
              |-- matchmaking
              |-- browser socket ticket
              `-- live WebSocket match join
```

Required production GitHub secrets include:

```text
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
RAILWAY_TOKEN
```

or the supported Railway API-token alternative used by the workflow.

---

# Environment and Secret Handling

Never commit real secrets, upload keys, service-account credentials, tokens, or production `.env` files.

Examples of sensitive configuration include:

```text
DATABASE_URL
REDIS_URL
CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID
RAILWAY_TOKEN
RAILWAY_API_TOKEN
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64
```

The Android upload keystore and its passwords must remain outside source control.

---

# Security Model

Security-sensitive operations follow several project rules:

- player identity is authenticated server-side;
- guest identity is validated with server-issued credentials;
- room tickets protect multiplayer joins;
- browser socket tickets avoid exposing unsuitable identity material in WebSocket URLs;
- Store mutations happen server-side;
- Google Play purchase callbacks never directly credit the local client;
- Play purchase tokens are verified server-side;
- Play receipt identity is stored as a digest for replay protection;
- paid grants execute inside a database transaction;
- duplicate purchase submission does not intentionally duplicate currency;
- known browser origins are explicitly handled by CORS policy;
- native/server clients without browser `Origin` headers remain supported where intended.

---

# Branch Strategy

The canonical integration branch is:

```text
main
```

Feature/repair work should generally follow:

```text
main
  |
  v
feature-or-repair-branch
  |
  v
build + tests + review
  |
  v
PR back to main
```

`Railway-API-Implementation` is transitional only and should mirror `main` until the Railway service source branch is switched to `main`.

Several historical `agent/*`, audit, build, and deployment-probe branches may remain in the repository. They should not be merged merely because they exist; many were intentionally temporary CI or release-validation branches.

---

# Production Release Checklist

Before an Android/public release, verify at minimum:

- [ ] Web build green
- [ ] Chromium/Firefox/WebKit smoke tests green
- [ ] Worker tests green
- [ ] Railway build/tests green
- [ ] PostgreSQL migrations green
- [ ] Android tests green
- [ ] Production Railway health endpoint healthy
- [ ] Cloudflare Worker deployed
- [ ] Browser WebSocket ticket endpoint live
- [ ] Web origin/CORS correct
- [ ] Public web client healthy
- [ ] Android endpoints explicitly configured for release
- [ ] Release artifact built with the intended signing key
- [ ] Store/cosmetics/season sanity checked
- [ ] Live Android multiplayer sanity checked
- [ ] Google Play products active before paid-currency testing
- [ ] Railway Google Play service account configured
- [ ] Voided-purchase reconciliation enabled and migrations 009–011 applied
- [ ] Season lifecycle reconciliation enabled
- [ ] RTDN provider configuration verified when RTDN is being enabled
- [ ] License-tester purchase verified before enabling paid commerce broadly

---

# Google Play Production Setup Checklist

For paid coins/gems:

1. Create and activate the four exact one-time product IDs in Google Play Console.
2. Configure regional availability and pricing.
3. Enable the Google Play Android Developer API for the backend service account.
4. Grant the service account appropriate Play Console access to Quiz Royale.
5. Store the service-account JSON only on Railway.
6. Deploy the Railway configuration.
7. Add a license tester and internal-test user.
8. Install the Play-distributed build.
9. Verify localized prices appear.
10. Perform a license-tester purchase.
11. Verify the Railway grant and updated balance.
12. Restart the app and confirm the receipt is not double-credited.

---

# Known Hardening / Polish Work

The 1.8 release adds automatic season rollover, match-visible cosmetics, safe Redis/PostgreSQL/billing health reporting, and authenticated RTDN ingestion. Remaining production work is narrower:

- finish Google Play / Pub/Sub provider-side RTDN configuration and matching Railway variables;
- switch the Railway production source branch from the transitional branch to canonical `main`;
- deeper adversarial commerce and multiplayer load/soak testing;
- permanent signed-AAB/R8 release validation in CI;
- more bespoke cosmetic artwork and animation;
- external alert delivery for abnormal API, matchmaking, database, and commerce failure rates;
- ongoing balance, seasonal-content, and trivia-quality tuning.

These are release-operations and polish tasks rather than missing core architecture.

---

# Troubleshooting

## Store shows paid packs as unavailable

Check:

- product IDs exactly match the four configured IDs;
- products are activated in Google Play Console;
- the installed build came from an eligible Play testing track;
- the current Google account is a license tester/test-track user;
- Railway billing verification is configured;
- the backend returned a valid account binding.

## Railway reports `billing_not_configured`

Set one of:

```text
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON
GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64
```

and redeploy Railway. Billing diagnostics are internal-only at `/internal/billing-status` and require `X-Internal-Token`.

## Railway reports `account_mismatch`

The Play purchase was not attributed to the same Quiz Royale account submitting the receipt. Do not bypass this check; investigate account/test setup.

## Browser cannot join a live match

Check:

- Worker deployment version;
- `/websocket-ticket` availability;
- Worker CORS;
- Railway CORS;
- room ticket validity;
- browser WebSocket connectivity.

## Existing local clone still shows old repository URL

```bash
git remote -v
git remote set-url origin https://github.com/adaPlu/quiz-royale-showdown.git
git fetch origin --prune
```

---

# Contributing

When making changes:

1. branch from the current integration branch;
2. keep each branch focused;
3. update tests when behavior changes;
4. do not commit credentials or generated secrets;
5. run the relevant local test lanes;
6. open a PR to `main`;
7. inspect CI failures instead of merging around them;
8. merge only after the affected system graph is green.

For economy, authentication, or multiplayer changes, favor server-authoritative behavior and idempotent operations.

---

# License

Copyright © 2026 Adam Pluguez.

All rights reserved unless otherwise specified by the repository owner.

---

# Author

**Adam Pluguez**

GitHub: `adaPlu`

Repository: `adaPlu/quiz-royale-showdown`
