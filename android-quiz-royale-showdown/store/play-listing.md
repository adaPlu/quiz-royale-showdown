# Google Play store listing — Quiz Royale Showdown

This document is the working source for the Google Play listing for the current `Railway-API-Implementation` branch.

> Architecture note: this branch uses the Android client + Cloudflare Worker/Durable Objects for real-time match routing, with the Railway API, PostgreSQL, and Redis for persistent services. Do not reuse older copy that says all account data is stored only on Cloudflare.

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
Earn and spend in-game virtual currency and power-up charges through gameplay. The current Android build does not use Google Play Billing or sell real-money purchases.

PLAY AS A GUEST OR REGISTER
Start without an account, or register to keep a persistent identity and progression. Registered accounts support sign-in, password recovery, friends, persistent stats, store inventory, cosmetics, and progression.

PLAY WITH FRIENDS
Find players by username, send and respond to friend invitations, and see friend presence information.

SERVER-AUTHORITATIVE MULTIPLAYER
Matchmaking and live game rooms are coordinated through Cloudflare Workers and Durable Objects. Persistent application data is handled through the Railway API backed by PostgreSQL and Redis.

NO ADS
The current build contains no advertising system.

Requires an internet connection.

Privacy Policy: https://quizroyale.gg/privacy-policy/
Support: quizroyaleshowdown@gmail.com
```

## Play Console field values

| Field | Value |
| --- | --- |
| Privacy policy URL | `https://quizroyale.gg/privacy-policy/` |
| Category | Games → Trivia |
| Contains ads | No |
| Google Play Billing / real-money IAP | No in the current build |
| Target age | 13+ (verify in Play Console questionnaires) |
| Internet required | Yes |
| Support email | `quizroyaleshowdown@gmail.com` |

## Data-safety working notes

Verify these against the exact release build before submitting the Play Console Data safety form.

### Registered accounts

The current application code uses data including:
- username/display name
- email address
- account/user identifiers and authentication credentials/tokens
- gameplay statistics and leaderboard/progression data
- friend relationships and presence state
- store inventory, virtual currency, cosmetics, power-up state, and seasonal progression

### Guest play

Guest sessions use temporary guest identifiers and gameplay/progression state required to provide the game.

### Infrastructure

- Cloudflare Workers and Durable Objects handle matchmaking and real-time game-room coordination.
- Railway hosts the persistent API.
- PostgreSQL stores persistent application data.
- Redis is used for caching/coordination.
- Network traffic uses HTTPS/WSS where configured in production.

Do not claim that persistent account data lives only on Cloudflare; that was true of an older branch and is not true of the Railway implementation.

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

These captures came from the older `main` branch. They are useful references and may still match the current UI, but re-check them against the final Railway build before publishing because the Railway branch has newer account recovery, friends/invites, store, progression, and backend integration work.

## Still required before publishing

- Verify the privacy-policy URL is publicly reachable from a logged-out browser.
- Re-check every Data safety answer against the exact release build and production infrastructure.
- Complete the Play Console content-rating and target-audience questionnaires.
- Create/verify the 1024 × 500 feature graphic.
- Replace any screenshot that no longer matches the current Railway build.
