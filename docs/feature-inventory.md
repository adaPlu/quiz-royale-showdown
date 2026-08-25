# Quiz Royale Feature Inventory

## Current In-Game Features

- Registered accounts with email, username, password login, sessions, logout, and password reset.
- Temporary guest sessions with guest stats that can be transferred during registration.
- Real-time match play over WebSockets.
- Match modes: quick match, tournament, and solo practice.
- Trivia questions by category and difficulty.
- Player stats, wins/losses, total points, streaks, category points, and best rank tracking.
- Global and category leaderboards for users and guests.
- Friends list for registered users.
- Add friends by username.
- Remove friends from the friends list.
- Friends-only presence showing idle, active, or in-match status.
- In-match power-ups: 50:50, Shield, and Double Down.
- Power-up charge inventory exposed through the API and shown in match state.
- Virtual currency balance model with coins, gems, and seasonal tickets.
- Premium and season-pass entitlement model.
- Google Play reviewer account provisioning when configured by environment variables.

## Requested Feature Backlog

- Friends list in game: implemented.
- Invite friends to the friends list: partially implemented through username add; dedicated invite flow is not implemented.
- Remove friends from the friends list: implemented.
- Global leaderboard: implemented.
- Seasons: partially implemented as season-pass entitlement and seasonal-ticket data; seasonal progression and reset flows are not implemented.
- In-game currency: partially implemented as balance data; earn/spend economy rules are not fully implemented.
- In-game store: not implemented.
- Store power-up items: partially implemented as power-up inventory/charges; purchase flow is not implemented.
- Store cosmetics: entitlement placeholder exists through reviewer access; cosmetic catalog, ownership, equip, and purchase flows are not implemented.

## Reviewer Account

- Reviewer email: `google-reviewer@quizroyale.gg`.
- Reviewer username: `google_reviewer`.
- Reviewer role: `google_play_reviewer`.
- Reviewer password must be set explicitly with `GOOGLE_PLAY_REVIEW_PASSWORD`.
- Recommended reviewer password for store review testing: configure `GOOGLE_PLAY_REVIEW_PASSWORD=Test?Test` in the target deployment environment.
