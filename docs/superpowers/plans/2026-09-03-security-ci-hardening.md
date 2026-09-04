# Security and CI Hardening Plan

## Goal

Restore the security-maintenance protections identified by `/Gaudit` without changing Quiz Royale gameplay or visual design.

## Scope

1. Restore CodeQL analysis for TypeScript/JavaScript and Android Kotlin.
2. Restore Dependabot version-update coverage for npm, Gradle, and GitHub Actions.
3. Add a production Cloudflare Pages Content-Security-Policy compatible with the existing Railway API and Cloudflare Worker/WebSocket endpoints.

## Constraints

- No UI layout, color, typography, animation, or gameplay changes.
- No secrets or credentials in configuration.
- CodeQL must analyze Kotlin through a real Gradle build rather than silently scanning Java only.
- CSP must keep the existing web multiplayer path functional.
- Dependabot should be weekly to avoid excessive PR churn.

## Task 1 — CodeQL

Create `.github/workflows/codeql.yml` using `github/codeql-action/*@v4`.

Matrix:
- `javascript-typescript`, build mode `none`.
- `java-kotlin`, build mode `manual`.

For `java-kotlin`, set up Java 17 and Gradle, initialize CodeQL, then build `android-quiz-royale-showdown/:app:assembleDebug` before analysis.

Run on:
- pushes to `main`
- PRs to `main`
- weekly scheduled scan
- manual dispatch

If GitHub Code Security is unavailable for this private repository, treat that as an account/provider configuration blocker rather than weakening/skipping analysis.

## Task 2 — Dependabot

Create `.github/dependabot.yml` covering:
- npm manifests at `/`, `/functions`, `/railway-api`, `/webapp`
- Gradle at `/android-quiz-royale-showdown`
- GitHub Actions at `/`

Use a weekly schedule and bounded open-PR limits.

## Task 3 — Content Security Policy

Update `webapp/public/_headers` with a CSP that allows:
- same-origin scripts/assets
- same-origin styles plus inline style attributes used by React/UI rendering
- the canonical Railway HTTPS API
- the canonical Cloudflare Worker HTTPS API
- the canonical Cloudflare Worker WSS endpoint

Deny objects, framing, foreign base URLs, and foreign form destinations.

## Verification

- Existing `UI and Web Test` must remain fully green.
- New CodeQL workflow must successfully initialize/build/analyze if the repository plan supports private CodeQL.
- PR diff must contain no UI source changes.
- After merge/deploy, production response headers should include the CSP; provider verification remains distinct from source-file presence.
