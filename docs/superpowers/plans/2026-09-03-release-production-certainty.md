# Release and Production Certainty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore deterministic green CI and establish one canonical, verifiable production backend revision before implementing new gameplay features.

**Architecture:** Keep production verification layered: Worker cryptographic tests prove local behavior, GitHub branch topology proves source-of-truth consistency, and provider health/configuration checks prove deployment reality. Never infer provider state from repository state alone.

**Tech Stack:** TypeScript, Node test runner, Cloudflare Workers/WebCrypto, GitHub Actions, Railway, PostgreSQL, Google Play Android Publisher API, Google Cloud Pub/Sub.

**Spec:** `docs/superpowers/specs/2026-09-03-release-production-certainty-design.md`

## Global Constraints

- Do not change UI visuals or gameplay behavior in this tranche.
- Do not weaken HMAC, authentication, CORS, billing, refund, or RTDN checks.
- Do not commit credentials, private keys, service-account JSON, Pub/Sub tokens, or Android signing secrets.
- `main` is the canonical source branch.
- Provider-side facts require direct provider/runtime evidence.

---

### Task 1: Make socket-ticket tamper coverage deterministic

**Files:**
- Modify: `functions/room-ticket.test.ts`
- Production code intentionally unchanged: `functions/room-ticket.ts`

**Interfaces:**
- Consumes: `mintSocketTicket(env, roomId, mode, identity, now)` and `verifySocketTicket(env, ticket, roomId, mode, now)`.
- Produces: deterministic regression coverage proving both payload and signature mutation fail verification.

- [ ] **Step 1: Preserve the existing failing CI evidence**

Baseline is GitHub Actions run `33795704394`, where `browser socket tickets reject tampering` failed while the verifier code matched the preceding green commit. This is the RED evidence for the test defect.

- [ ] **Step 2: Replace the pad-bit mutation with a signed-payload mutation**

Change the test body after `assert(ticket)` to split the ticket and mutate the first encoded payload character:

```ts
  const [encoded, signature] = ticket.split(".");
  assert(encoded && signature);
  const payloadTampered = `${encoded[0] === "a" ? "b" : "a"}${encoded.slice(1)}.${signature}`;
  assert.equal(await verifySocketTicket(env, payloadTampered, "room-a", "QUICK", 2_000), null);
```

- [ ] **Step 3: Add a non-terminal signature mutation assertion**

In the same test add:

```ts
  const signatureIndex = Math.min(5, signature.length - 2);
  const replacement = signature[signatureIndex] === "a" ? "b" : "a";
  const signatureTampered = `${encoded}.${signature.slice(0, signatureIndex)}${replacement}${signature.slice(signatureIndex + 1)}`;
  assert.equal(await verifySocketTicket(env, signatureTampered, "room-a", "QUICK", 2_000), null);
```

This changes a character that contributes actual signature bits rather than terminal Base64URL pad bits.

- [ ] **Step 4: Verify through PR CI**

Expected Worker job command:

```bash
npm test --prefix functions
```

Expected: all Worker tests and typecheck pass.

- [ ] **Step 5: Commit**

Commit message:

```text
fix: make socket ticket tamper test deterministic
```

---

### Task 2: Reconcile the transitional Railway branch with canonical main

**Files:**
- No application file changes unless a unique transitional commit is proven required.
- Read: branch `Railway-API-Implementation`
- Read: `railway.json`
- Read: `railway-api/src/server.ts`

**Interfaces:**
- Consumes: current `main` SHA and transitional branch SHA.
- Produces: one unambiguous source branch for deployment, with the transitional branch either synchronized or retired.

- [ ] **Step 1: Inspect branch divergence**

Compare:

```text
Railway-API-Implementation...main
```

Record merge base, unique commits, and changed files.

- [ ] **Step 2: Inspect every commit unique to `Railway-API-Implementation`**

A unique commit may be discarded only if its behavior is already present on `main`, is deployment-only history with no tree change, or is explicitly obsolete. Any required behavior must first be ported to `main` through a reviewed change.

- [ ] **Step 3: Synchronize the transitional branch only if safe**

If no required unique tree change exists, move `Railway-API-Implementation` to the verified `main` SHA. If force movement would discard required behavior, do not move it; instead preserve that behavior on `main` first.

- [ ] **Step 4: Verify repository deployment contract**

`railway.json` must continue to build and test the Railway API and start with migrations:

```json
{
  "build": {
    "builder": "RAILPACK",
    "buildCommand": "npm ci --prefix railway-api && npm run build --prefix railway-api && REDIS_URL= npm test --prefix railway-api"
  },
  "deploy": {
    "startCommand": "npm run migrate --prefix railway-api && npm start --prefix railway-api"
  }
}
```

- [ ] **Step 5: Verify provider/runtime state**

Required evidence:

```text
Railway source branch = main
config path = /railway.json
/health HTTP 200
/health.version = current main SHA prefix
/health.dependencies.postgres = connected
migration 012 applied
```

If the Railway provider cannot be queried or changed from available tools, record the exact unresolved provider action as `NEEDS_MORE_EVIDENCE`; do not mark complete.

---

### Task 3: Verify Google Play RTDN configuration contract

**Files:**
- Read: `railway-api/src/commerce.ts`
- Read: `railway-api/src/server.ts`
- Read: `railway-api/src/commerce.test.ts`
- Optional documentation update: `railway-api/README.md`

**Interfaces:**
- Consumes: environment variables `GOOGLE_PLAY_RTDN_AUDIENCE`, `GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_PLAY_PACKAGE_NAME` and the public endpoint `/google-play/rtdn`.
- Produces: explicit configuration checklist and runtime evidence for authenticated Pub/Sub push delivery.

- [ ] **Step 1: Verify application-side route and auth expectations**

Confirm `/google-play/rtdn` is public only to authenticated Google Pub/Sub push identity and that OIDC claims validate audience, service-account email, issuer, expiry and `email_verified`.

- [ ] **Step 2: Verify package and endpoint constants**

Expected production package unless separately migrated:

```text
com.rork.quizroyaleshowdown
```

Expected push URL:

```text
https://<canonical-railway-api-host>/google-play/rtdn
```

- [ ] **Step 3: Verify provider configuration directly**

Required Google Cloud Pub/Sub subscription settings:

```text
Push delivery enabled
Push endpoint = canonical Railway /google-play/rtdn
Authentication enabled
Service account = same value as GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL
Audience = same value as GOOGLE_PLAY_RTDN_AUDIENCE
```

- [ ] **Step 4: Send/observe a Google test notification**

Expected endpoint result: HTTP 2xx. Then verify the RTDN event is recorded exactly once when the same message is redelivered.

- [ ] **Step 5: Verify pending-refund and void paths**

Pending refund notification must create one `play_pending_refund_reviews` row with deadline `received/event time + 24h`. A voided purchase notification must reconcile without applying a duplicate currency reversal on redelivery.

- [ ] **Step 6: Record provider-only blockers explicitly**

If connected tools cannot inspect Pub/Sub or Play Console, report the provider checks as `NEEDS_MORE_EVIDENCE` while keeping repository-side tests green.

---

### Task 4: Gate completion and merge

**Files:**
- No production files beyond Tasks 1-3.

**Interfaces:**
- Consumes: PR CI, branch comparison, deployment evidence.
- Produces: a merge-ready A-series tranche or a precise provider blocker list.

- [ ] **Step 1: Open PR from `repair/graph-a-release-certainty` to `main`**

PR title:

```text
repair: restore release and production certainty
```

- [ ] **Step 2: Require all code-level checks to pass**

Expected jobs:

```text
Web build and browser smoke
Worker tests
Railway API build, migrations and tests
Android unit tests
```

- [ ] **Step 3: Re-check the diff**

Confirm there is no UI change, credential material, unrelated refactor, or production-code weakening.

- [ ] **Step 4: Merge only after green code-level verification**

Provider-only unresolved checks remain documented separately and do not become false green claims.