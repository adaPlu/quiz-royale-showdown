# Quiz Royale Showdown Web

React + TypeScript + Vite browser client for the same Quiz Royale Showdown production ecosystem used by Android.

## Architecture

The browser never connects directly to PostgreSQL or Redis.

```text
Web browser ─┬─ HTTPS ─► Railway API ─► PostgreSQL + Redis
             └─ HTTPS/WSS ─► Cloudflare Worker + Durable Objects
Android ─────┴───────────────────────────────────────────────┘
```

This keeps accounts, guest sessions, stats, friends, store inventory, seasons, leaderboards, questions and match results shared across Android and Web.

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
```

Production defaults already point at those services.

## Browser WebSocket authentication

Browsers cannot add Android's custom authentication headers to a WebSocket handshake. The web client therefore:

1. Gets a normal `roomTicket` from `/matchmake`.
2. Calls `POST /websocket-ticket` over HTTPS with the regular bearer token or guest headers.
3. Receives a signed, two-minute socket identity ticket.
4. Opens the WSS connection using the room ticket + short-lived socket ticket.

Long-lived user/guest secrets are not placed in the WebSocket URL.

## Cloudflare Pages deployment

Recommended Pages project settings:

- Root directory: `webapp`
- Build command: `npm install && npm run build`
- Build output directory: `dist`
- Production branch: whichever branch is promoted from `UITest`

Recommended domains:

- `quizroyale.gg` or `play.quizroyale.gg` → Cloudflare Pages web client
- Railway API remains the persistent REST service
- `quiz-royale-functions.adapluguez.workers.dev` (or a custom game subdomain) remains the multiplayer Worker

The existing `public/privacy-policy/` directory is copied into the Vite build automatically, so `/privacy-policy/` remains available from the web deployment.

## Release gate

Before production promotion:

```bash
npm run build
npm test --prefix ../functions
```

Also run Android unit tests from `android-quiz-royale-showdown` to ensure the shared Worker changes did not regress the mobile client.
