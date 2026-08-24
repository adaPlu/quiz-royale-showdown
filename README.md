# Quiz Royale Showdown

**Quiz Royale Showdown** is a real-time multiplayer trivia battle royale where players compete in fast-paced quiz matches, earn rewards, climb leaderboards, unlock cosmetics, use power-ups, and compete across seasons.

The project combines an **Android client**, **Cloudflare Workers / Durable Objects**, a **Railway-hosted API**, **PostgreSQL**, and **Redis** to provide real-time multiplayer gameplay with persistent player progression.

## Features

- Real-time multiplayer trivia matches
- Quick Match matchmaking
- Tournament and Practice game modes
- Guest and registered player support
- JWT-based authentication
- Secure room tickets for multiplayer sessions
- WebSocket gameplay
- Timed trivia rounds
- Difficulty-based question selection
- Player elimination and match results
- Global leaderboard
- Friends system
- Player profiles
- XP and progression
- Seasons
- Cosmetics
- Store system
- Power-ups and player inventory
- Match reporting
- Redis-backed caching and coordination
- PostgreSQL persistence
- Railway deployment
- Cloudflare Durable Objects for real-time game rooms

---

## Architecture

```text
┌─────────────────────────────┐
│       Android Client        │
│      Kotlin / Compose       │
└──────────────┬──────────────┘
               │
               │ HTTPS / WebSocket
               ▼
┌─────────────────────────────┐
│     Cloudflare Worker       │
│                             │
│  • Matchmaking              │
│  • Room tickets             │
│  • WebSocket routing        │
│  • Identity validation      │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│      Durable Objects        │
│                             │
│  Real-time match state      │
│  Round synchronization      │
│  Player connections         │
└──────────────┬──────────────┘
               │ Internal API
               ▼
┌─────────────────────────────┐
│        Railway API          │
│     Node.js / TypeScript    │
│                             │
│  • Authentication           │
│  • Questions                │
│  • Friends                  │
│  • Leaderboards             │
│  • Seasons                  │
│  • Store                    │
│  • Player progression       │
└──────────┬─────────┬────────┘
           │         │
           ▼         ▼
     PostgreSQL    Redis
```

---

## Tech Stack

### Android

- Kotlin
- Jetpack Compose
- Android Studio
- REST APIs
- WebSockets

### Backend

- Node.js
- TypeScript
- PostgreSQL
- Redis
- REST APIs
- JWT authentication

### Multiplayer Infrastructure

- Cloudflare Workers
- Cloudflare Durable Objects
- WebSockets

### Deployment

- Railway
- Cloudflare
- GitHub

---

## Repository Structure

```text
quiz-royale-showdown/
│
├── android-quiz-royale-showdown/
│   └── Android application
│
├── functions/
│   ├── Cloudflare Worker
│   ├── matchmaking
│   ├── Durable Object game rooms
│   └── Railway API integration
│
├── railway-api/
│   ├── src/
│   ├── migrations/
│   ├── tests/
│   └── package.json
│
├── webapp/
│   └── Web-facing application resources
│
├── railway.json
├── package.json
└── README.md
```

---

# Gameplay

Players enter matchmaking and are assigned to a multiplayer trivia room.

Each game consists of a sequence of timed questions. Players submit answers before the timer expires and the server evaluates each response.

Depending on the game mode, incorrect answers, score, timing, and other game rules determine player progression or elimination.

At the end of a match, player statistics and progression are persisted.

```text
Player
   │
   ▼
Matchmaking
   │
   ▼
Room Created
   │
   ▼
Players Join
   │
   ▼
Question
   │
   ▼
Answers Submitted
   │
   ▼
Results
   │
   ├── Next Round ──► Question
   │
   └── Match Complete
              │
              ▼
       Rewards / XP / Stats
```

---

# Question System

The production question source of truth is the PostgreSQL:

```text
QuestionBank
```

The application does **not** use a separate lowercase `questions` table.

`QuestionBank` currently contains more than **4,400 trivia questions** covering multiple difficulty levels.

Questions support:

- Easy
- Medium
- Hard
- Multiple answer choices
- Correct-answer tracking
- Category information
- Active/inactive state
- Question usage tracking

The Railway API selects questions from `QuestionBank` when multiplayer games request a new question set.

Generated questions are also stored directly in `QuestionBank`.

---

# Matchmaking

Matchmaking is coordinated by the Cloudflare Worker.

The basic flow is:

```text
Android Client
      │
      ▼
/matchmake
      │
      ▼
Cloudflare Worker
      │
      ▼
Match Assignment
      │
      ▼
Signed Room Ticket
      │
      ▼
Durable Object
      │
      ▼
WebSocket Match
```

Room tickets prevent clients from simply supplying arbitrary player identities when joining game rooms.

---

# Authentication

Quiz Royale Showdown supports both registered users and guests.

Registered player sessions use authentication tokens when communicating with protected API endpoints.

Security controls include:

- JWT authentication
- Refresh-token handling
- Internal API authentication
- Signed multiplayer room tickets
- Route-level authorization
- Request validation
- Rate limiting
- Server-side identity validation

Sensitive credentials and production secrets should always be supplied through deployment environment variables and must never be committed to the repository.

---

# Social Features

Players can interact through the built-in friends system.

Supported operations include:

- Send friend requests
- Accept friend requests
- View friends
- Remove friends
- Player discovery
- Player profiles

Friendship operations enforce ownership and authorization server-side.

---

# Player Progression

Player progression is persisted between games.

The backend supports data such as:

- XP
- Player statistics
- Match history/results
- Leaderboard rankings
- Seasonal progression
- Cosmetics
- Power-ups
- Inventory

---

# Seasons

Quiz Royale Showdown supports seasonal competition.

Seasons provide a foundation for:

- Seasonal rankings
- Seasonal progression
- Rewards
- Time-limited competition
- Future seasonal content

---

# Store and Cosmetics

Players can obtain and manage cosmetic content through the store system.

The backend provides support for:

- Store items
- Cosmetics
- Player inventory
- Purchases
- Item ownership

The design keeps purchasing and inventory state server-authoritative.

---

# Power-Ups

Players can acquire and use power-ups during gameplay.

Power-up state is stored in the player's inventory and validated by the backend rather than trusting client-side state.

---

# Leaderboards

Quiz Royale Showdown maintains persistent leaderboard information using player statistics stored in PostgreSQL.

Leaderboard information can be used for:

- Global ranking
- Seasonal ranking
- Player comparison
- Competitive progression

---

# Local Development

## Prerequisites

Install:

- Git
- Node.js
- npm
- Android Studio
- Java/JDK required by the Android project
- PostgreSQL
- Redis

Cloudflare development additionally requires Wrangler.

```bash
npm install -g wrangler
```

---

## Clone the Repository

```bash
git clone https://github.com/adaPlu/rork-quiz-royale-showdown.git
cd rork-quiz-royale-showdown
```

---

# Railway API

Install dependencies:

```bash
cd railway-api
npm install
```

Build the API:

```bash
npm run build
```

Run the tests:

```bash
npm test
```

Start the API using the development command configured in `railway-api/package.json`.

---

# Cloudflare Worker

Move into the Worker project:

```bash
cd functions
npm install
```

Run tests:

```bash
npm test
```

Start the local Cloudflare development environment:

```bash
npx wrangler dev
```

---

# Android Application

Open:

```text
android-quiz-royale-showdown/
```

with Android Studio.

Allow Gradle to synchronize the project, select an emulator or physical Android device, and run the application.

Android unit tests can also be executed with Gradle:

```bash
./gradlew :app:testDebugUnitTest
```

On Windows:

```powershell
.\gradlew.bat :app:testDebugUnitTest
```

---

# Environment Variables

Production configuration should be provided through Railway and Cloudflare environment variables.

Typical backend configuration includes values for services such as:

```env
DATABASE_URL=
REDIS_URL=
INTERNAL_API_TOKEN=
JWT_SECRET=
```

Additional configuration may be required depending on the enabled services.

**Never commit real production secrets or `.env` files containing credentials.**

---

# Database Migrations

Railway API SQL migrations are located in:

```text
railway-api/migrations/
```

Migrations are used to evolve production database functionality such as:

- Authentication
- Questions
- Player statistics
- Social features
- Seasons
- Store
- Inventory

The current application uses the existing PostgreSQL `QuestionBank` table as the authoritative trivia-question source.

---

# Testing

The project contains automated tests for important backend and multiplayer functionality.

### Railway API

```bash
npm test --prefix railway-api
```

### Cloudflare Worker

```bash
npm test --prefix functions
```

### Android

```powershell
cd android-quiz-royale-showdown
.\gradlew.bat :app:testDebugUnitTest
```

Tests should be run before production deployment.

---

# Deployment

## Railway API

The production API is deployed through Railway.

Railway handles:

- Node.js application deployment
- PostgreSQL
- Redis
- Environment configuration
- Database migrations
- Service health monitoring

## Cloudflare

Cloudflare hosts the multiplayer edge layer and Durable Objects responsible for live matches.

This separates persistent API/database operations from low-latency real-time room coordination.

---

# Security

Security is treated as a server-side responsibility.

Important design principles include:

- Never trust player IDs supplied directly by clients.
- Authenticate protected API routes.
- Perform authorization separately from authentication.
- Verify multiplayer room tickets.
- Keep game state server-authoritative.
- Validate request bodies.
- Rate-limit sensitive endpoints.
- Keep internal API endpoints protected.
- Store secrets only in environment configuration.
- Prevent unauthorized users from modifying another player's resources.

---

# Production Flow

```text
                   ┌──────────────┐
                   │   Android    │
                   │    Client    │
                   └──────┬───────┘
                          │
                 HTTPS / WebSocket
                          │
             ┌────────────▼────────────┐
             │    Cloudflare Worker    │
             │                         │
             │ Matchmaking / Routing   │
             └────────────┬────────────┘
                          │
                  ┌───────▼────────┐
                  │ Durable Object │
                  │   Match Room   │
                  └───────┬────────┘
                          │
                   Internal API
                          │
             ┌────────────▼────────────┐
             │       Railway API       │
             │    Node / TypeScript    │
             └───────┬─────────┬───────┘
                     │         │
               ┌─────▼───┐ ┌──▼─────┐
               │Postgres │ │ Redis  │
               └─────────┘ └────────┘
```

---

# Current Development Status

Quiz Royale Showdown is under active development.

Core infrastructure currently includes:

- Android client
- Production Railway API
- PostgreSQL database
- Redis
- Cloudflare Worker
- Durable Object multiplayer rooms
- Authentication
- Matchmaking
- Question selection
- Friends
- Leaderboards
- Player progression
- Seasons
- Store
- Cosmetics
- Power-ups

Additional gameplay balancing, UI refinement, testing, observability, and production hardening are ongoing.

---

# Roadmap

Planned and continuing development includes:

- Expanded game modes
- Improved matchmaking
- Tournament improvements
- More social functionality
- Expanded seasonal rewards
- Additional cosmetics
- More power-ups
- Question-bank expansion
- Improved player statistics
- Match history
- Achievement systems
- Stronger abuse prevention
- Additional integration and load testing
- Improved monitoring and observability

---

# Privacy

Quiz Royale Showdown stores only the account, gameplay, progression, and service data required to operate the application.

A dedicated privacy policy should be provided through the application's Google Play listing and associated public website.

---

# Contributing

This project is currently under active development.

When contributing:

1. Create a feature or fix branch.
2. Keep changes focused.
3. Add or update tests when behavior changes.
4. Run the relevant test suites.
5. Avoid committing secrets or generated build artifacts.
6. Open a pull request describing the change and how it was tested.

---

# License

Copyright © 2026.

All rights reserved unless otherwise specified by the repository owner.

---

## Author

**Adam Pluguez**

GitHub: **adaPlu**

Project repository:  
`adaPlu/rork-quiz-royale-showdown`
