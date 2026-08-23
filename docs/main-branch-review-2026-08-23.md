# Main branch review — 2026-08-23

This note records the review of `main` against `Railway-API-Implementation` without merging or modifying `main`.

## Branch relationship at review time

- `Railway-API-Implementation`: `5f1b2cf50ec6c171698c0eeaf29ee1719c8639a3`
- `main`: `25df1bdf47b8f3a9aba5b8c0e792254a95eb3378`
- GitHub reported the branches as diverged.
- `main` had 4 commits not present on the Railway branch.
- The Railway branch had 10 commits not present on `main`.

## Main-only commits reviewed

1. `727e3cf2fd97aac568b29d6e8b3408e675ddebda` — `Stopped by user`
   - No file changes.
   - Nothing to port.

2. `c4828afd21ebdd9905a5d89b5162d2a610145cfc` — legal/store work
   - Added Android legal-link UI.
   - Added Worker-hosted privacy/terms pages.
   - Added initial Play Store listing metadata.

3. `1347b6b256e8cb8754e5f148c2112a1595f7dbdf` — follow-up commit
   - No file changes.
   - Nothing to port.

4. `25df1bdf47b8f3a9aba5b8c0e792254a95eb3378` — store-listing/screenshots update
   - Added seven Play-compatible phone screenshots.
   - Updated listing/support information.

## What was ported

- The seven phone screenshot assets were copied to the Railway branch because they are useful Play Store reference assets and do not affect runtime behavior.
- The Play Store listing was recreated on the Railway branch with the current hybrid architecture (Cloudflare real-time layer + Railway API + PostgreSQL + Redis) and the current privacy-policy URL: `https://quizroyale.gg/privacy-policy/`.

## What was intentionally not ported

### `functions/legal.ts`

The old policy text states that accounts/leaderboards are hosted entirely on Cloudflare and describes an older data model. The Railway branch now uses a Railway API with PostgreSQL and Redis for persistent services. Copying the old legal document would make the privacy disclosures inaccurate.

### Main's `functions/index.ts`

The Railway branch has newer security and routing work including room tickets, Railway API resolution, stronger guest credentials, typed Durable Object dispatch, expanded CORS headers, and password-reset routes. Replacing it with `main` would regress those changes.

### Main's `Legal.kt`, `AuthScreen.kt`, and `ProfileScreen.kt`

`Legal.kt` references the obsolete `Backend.baseUrl` API, while the Railway branch now separates `restBaseUrl` and `matchHttpBase`. The Railway Auth/Profile screens also contain newer password-recovery and friend-invite behavior. Copying the old files wholesale would either fail compilation or remove newer functionality.

If legal links are added to the Android UI later, they should be implemented against the current privacy URL and current Railway architecture rather than cherry-picking the old files unchanged.

## Safety rule

`main` was treated as read-only during this review. No merge, ref update, commit, or file write was made to `main`.
