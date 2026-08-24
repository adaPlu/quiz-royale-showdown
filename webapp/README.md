# Quiz Royale Showdown Web

React + TypeScript + Vite browser client for the same Quiz Royale Showdown production ecosystem used by Android.

## Architecture

The browser never connects directly to PostgreSQL or Redis.

```text
Web browser ─┬─ HTTPS ─► Railway API ─► PostgreSQL + Redis
             └─ HTTPS/WSS ─► Cloudflare Worker + Durable Objects
Android ─────┴───────────────────────────────────────────────┘
```

Accounts, guest sessions, stats, friends, invites, store inventory, cosmetics, seasons, leaderboards, questions and match results are shared across Android and Web.

## Current web feature surface

- Persistent HOME / PLAY / STORE / SEASON / PROFILE navigation
- Guest sessions with activity-aware heartbeat and expiry warnings
- Register/sign-in with guest-stat transfer
- Global/category leaderboard panel
- Friends list, player search, invites, accept/decline/cancel and remove
- Store purchases and shared currency balances
- Cosmetics collection/equip UI
- Season XP/progression
- Quick Match, Tournament and Practice matchmaking
- Browser-safe short-lived WebSocket identity tickets
- Match reconnect attempts, join timeout, keyboard answers and power-up controls
- Responsive desktop/mobile layout and reduced-motion/focus accessibility support

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

Optional overrides:

```env
VITE_RAILWAY_API_URL=https://railway-api-production-5772.up.railway.app
VITE_FUNCTIONS_URL=https://quiz-royale-functions.adapluguez.workers.dev
VITE_TELEMETRY_URL=
```

Production defaults already point at the Railway and Cloudflare services. `VITE_TELEMETRY_URL` is optional; when absent, no telemetry is sent off-device.

## Browser WebSocket authentication

Browsers cannot add Android's custom authentication headers to a WebSocket handshake. The web client therefore:

1. Gets a normal `roomTicket` from `/matchmake`.
2. Calls `POST /websocket-ticket` over HTTPS with the regular bearer token or guest headers.
3. Receives a signed, two-minute socket identity ticket.
4. Opens the WSS connection using the room ticket + short-lived socket ticket.

Long-lived user/guest secrets are not placed in the WebSocket URL.

## Browser tests

The smoke suite uses mocked backend responses so navigation and feature surfaces can be validated without modifying production data.

```bash
npx playwright install chromium firefox webkit
npm run test:e2e
```

CI runs the suite in Chromium, Firefox and WebKit after TypeScript/Vite build verification.

## Cloudflare Pages deployment

Recommended Pages project settings:

- Root directory: `webapp`
- Build command: `npm install && npm run build`
- Build output directory: `dist`
- Production branch: whichever branch is promoted from `UITest`

A manual GitHub workflow is available at `.github/workflows/deploy-web-pages.yml`. It requires repository/environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

Recommended domains:

- `quizroyale.gg` or `play.quizroyale.gg` → Cloudflare Pages web client
- Railway API remains the persistent REST service
- `quiz-royale-functions.adapluguez.workers.dev` (or a custom game subdomain) remains the multiplayer Worker

The existing `public/privacy-policy/` directory is copied into the Vite build automatically, so `/privacy-policy/` remains available from the web deployment.

## Production-origin hardening

The Cloudflare Worker enforces an explicit browser-origin allowlist. Built-in approved origins are:

```text
https://quizroyale.gg
https://www.quizroyale.gg
https://play.quizroyale.gg
http://localhost:5173
http://127.0.0.1:5173
http://localhost:4173
http://127.0.0.1:4173
```

Additional exact staging or preview origins can be supplied through the Worker's `CORS_ORIGINS` comma-separated variable or the legacy `CORS_ORIGIN` variable. Unknown browser origins receive HTTP 403. Requests without an `Origin` header remain permitted so Android/native and server-to-server traffic continue to work.

The Railway API already supports the `CORS_ORIGIN` environment variable. Before public deployment, set it to the exact public web origin—for example `https://play.quizroyale.gg`—rather than leaving the wildcard fallback. If multiple public Railway browser origins become necessary, extend that single-origin policy deliberately instead of using `*` for authenticated routes.

## Release gate

Before production promotion:

```bash
npm run build
npm run test:e2e
npm test --prefix ../functions
```

Also run Android unit tests from `android-quiz-royale-showdown` to ensure shared Worker changes did not regress the mobile client. Then perform one real Android ↔ Web multiplayer match against the intended production/staging infrastructure before deploying the public URL.
