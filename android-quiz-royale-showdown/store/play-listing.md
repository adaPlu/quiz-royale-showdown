# Google Play store listing — Quiz Royale Showdown

This document is the working source for the Google Play listing for the authoritative private `main` branch.

> Architecture note: the current build uses the Android client + Cloudflare Worker/Durable Objects for real-time match routing, with the Railway API, PostgreSQL, and Redis for persistent services. Google Play Billing is used for optional Android coin and gem purchases.

## App name

```text
Quiz Royale Showdown
```

## Short description

```text
Live trivia battle royale. Answer fast, survive rounds, outlast every rival.
```

## Full description

```text
Quiz Royale Showdown is a real-time multiplayer trivia battle royale. Players face the same questions under time pressure, score points for correct answers, survive elimination rounds, and compete to finish on top.

THREE WAYS TO PLAY
• Quick Match — jump into a live multiplayer lobby
• Tournament — play longer, higher-stakes rounds
• Practice — sharpen your trivia skills at your own pace

BUILD YOUR RECORD
Track wins, losses, points, best placements, category progress, badges, XP, seasonal progress, power-up inventory, cosmetics, and leaderboard position.

POWER-UPS AND REWARDS
Earn coins, gems, tickets, and power-up charges through gameplay and progression. Registered Android players may also choose to buy optional coin or gem packs through Google Play. A purchase is never required to play matches or earn virtual currency through normal gameplay.

PLAY AS A GUEST OR REGISTER
Start without an account, or register to keep a persistent identity and progression. Registered accounts support sign-in, password recovery, friends, persistent stats, store inventory, cosmetics, seasonal progression, and optional Google Play purchases.

PLAY WITH FRIENDS
Find players by username, send and respond to friend invitations, and see friend presence information.

SERVER-AUTHORITATIVE MULTIPLAYER
Matchmaking and live game rooms are coordinated through Cloudflare Workers and Durable Objects. Persistent application data is handled through the Railway API backed by PostgreSQL and Redis.

NO ADS
The current build contains no advertising system.

Requires an internet connection.

Privacy Policy: https://quiz-royale-showdown.pages.dev/privacy-policy/
Support: quizroyaleshowdown@gmail.com
```

## Play Console field values

| Field | Value |
| --- | --- |
| Privacy policy URL | `https://quiz-royale-showdown.pages.dev/privacy-policy/` |
| Category | Games → Trivia |
| Contains ads | No |
| Google Play Billing / real-money IAP | Yes — optional one-time consumable coin and gem packs |
| Target age | 13+ (verify in Play Console questionnaires) |
| Internet required | Yes |
| Support email | `quizroyaleshowdown@gmail.com` |

## Paid Android products

The backend catalog expects these Google Play one-time in-app product IDs. The Play Console price is authoritative; do not hard-code localized real-money prices in the app or backend.

| Product ID | Grant |
| --- | ---: |
| `quiz_coins_500` | 500 coins |
| `quiz_coins_1200` | 1,200 coins |
| `quiz_gems_50` | 50 gems |
| `quiz_gems_140` | 140 gems |

All four are intended as consumable digital products. Railway verifies the Google Play purchase before granting currency and records the transaction idempotently so the same purchase token cannot credit currency twice.

## Data-safety working notes

Verify these against the exact release build and current Play Console wording before submission.

### Registered accounts

The current application uses data including:
- username/display name
- email address
- account/user identifiers and authentication credentials/tokens
- gameplay statistics, badges, leaderboard and progression data
- friend relationships and presence state
- store inventory, virtual currency, cosmetics, power-up state, and seasonal progression

### Google Play purchases

For optional paid coin/gem packs, the app/backend process:
- Google Play product ID
- Google Play purchase token for server-side verification
- a hashed/non-PII account binding used to bind checkout to the Quiz Royale account
- transaction/order ID when Google supplies one
- quantity and purchase time when Google supplies them
- granted virtual-currency amount and verification/finalization records

The app does **not** receive or store the user's full payment-card or bank-account details; Google Play handles the payment method.

### Guest play

Guest sessions use temporary guest identifiers and gameplay/progression state required to provide the game. Paid currency purchases require a registered/sign-in session in the current Android store flow.

### Infrastructure

- Cloudflare Workers and Durable Objects handle matchmaking and real-time game-room coordination.
- Railway hosts the persistent API and Google Play verification endpoint.
- PostgreSQL stores persistent application, virtual-economy, and purchase-receipt data.
- Redis is used for caching/coordination.
- Google Play handles Android distribution and in-app billing.
- Network traffic uses HTTPS/WSS in production.

## Phone screenshots

The repository contains seven Play-compatible reference captures under `store/screenshots/phone/`:

1. `01-main.png` — main screen
2. `02-quickstart.png` — Quick Match lobby/countdown
3. `03-question.png` — live trivia round
4. `04-tournament.png` — Tournament lobby
5. `05-midround.png` — mid-round gameplay
6. `06-register.png` — registration screen
7. `07-standings.png` — leaderboard/standings

The images are 810 × 1616 PNGs, padded to satisfy Google Play's phone-screenshot aspect-ratio limit without cropping the captured UI.

These captures predate some current account recovery, friends/invites, store, billing, progression, and backend-integration changes. Re-check every screenshot against the release build before publishing.

## Still required before publishing / monetization launch

- Confirm `https://quiz-royale-showdown.pages.dev/privacy-policy/` and `/terms/` are publicly reachable from a logged-out browser after Pages deploy.
- Re-check every Data safety answer against the exact signed release build and production infrastructure.
- Complete/verify the Play Console content-rating and target-audience questionnaires.
- Create and activate the four one-time in-app products with the exact IDs above and set prices in Play Console.
- Configure the Google Play Android Publisher service account used by Railway for server-side purchase verification.
- Test purchase, pending purchase, cancellation, duplicate verification, and restore/reconciliation through a Play internal-testing build before production rollout.
- Replace screenshots that no longer match the current UI and verify the 1024 × 500 feature graphic.
