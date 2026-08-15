# Google Play store listing — Quiz Royale Showdown

This is the source of truth for the Play Console listing. Paste each block into
the matching Play Console field.

> **Note on "App Store":** this project ships Android only (`rork.json` has no iOS
> app), so the live listing is Google Play. The Apple Standard EULA link below is
> included so the same copy can be reused verbatim if an iOS build is added later —
> Apple's EULA has no effect on an Android-only release.

---

## App name (max 30 chars)

```
Quiz Royale Showdown
```
`20/30`

## Short description (max 80 chars)

```
Live trivia battle royale. Answer fast, survive rounds, outlast every rival.
```
`74/80`

---

## Full description (max 4000 chars)

```
Quiz Royale Showdown is a real-time trivia battle royale. You and your rivals face the same question at the same moment — answer fast and correctly to survive, hesitate and you're out. Rounds continue until one player is left standing.

LAST ONE STANDING
Every match is elimination. Lose your lives and you're knocked out, but you stay to watch the finish. Speed matters as much as accuracy: the faster you lock in a correct answer, the bigger your score, and answer streaks stack on top.

THREE WAYS TO PLAY
• Quick Match — jump straight into a fast lobby against live opponents
• Tournament — longer brackets, more rounds, higher stakes
• Practice — drill solo at your own pace. Points and category progress still count, your win/loss record stays untouched

POWER-UPS THAT SWING A ROUND
Spend charges earned from play at the moment it counts most:
• 50/50 — cut two wrong answers from the board
• Shield — survive one wrong answer without losing a life
• Double Down — double your points on a question you're sure of

CLIMB THE WORLD BOARD
Global and per-category leaderboards rank every player. Reach the top 100, top 10, top 3 or world number one and the milestone is yours permanently — badges are captured the moment you earn them and never disappear if someone later overtakes you.

EARN YOUR BADGE SHELF
Nine tiers across five families: match wins, leaderboard milestones, career points, correct answers, and taking first place. Your profile tracks career stats, best finish, best score, power-up charges and per-category mastery.

PLAY WITHOUT AN ACCOUNT
No sign-up wall. Start playing instantly as a guest — your wins, points, power-ups and leaderboard spot all count. Guest sessions are temporary and reset after 30 minutes of inactivity, and the app shows you a countdown before that happens.

Register when you're ready and choose to carry your guest run across to a permanent account: stats that persist forever, a friends list, and a durable identity.

PLAY WITH FRIENDS
Add friends by username and see who's around at a glance — online, in a match, or last seen. Compare points and crowns side by side.

BUILT FAIR
Every score, elimination and ranking is calculated on our servers, never on your device. Answers stay hidden until the reveal, so no one can read ahead. Passwords are salted and hashed and never stored in readable form.

NO ADS. NO TRACKING.
Quiz Royale Showdown contains no advertising, no analytics SDKs and no third-party trackers. It requests no access to your location, contacts, photos, camera or microphone.

Requires an internet connection.

—

Privacy Policy: https://quiz-royale-showdown-backend.rork.app/legal/privacy
Terms and Conditions: https://quiz-royale-showdown-backend.rork.app/legal/terms
End User License Agreement (Apple Standard EULA): https://www.apple.com/legal/internet-services/itunes/dev/stdeula/
Support: support@quizroyaleshowdown.app
```

---

## Play Console field values

| Field | Value |
| --- | --- |
| Privacy policy URL | `https://quiz-royale-showdown-backend.rork.app/legal/privacy` |
| Category | Games → Trivia |
| Contains ads | **No** |
| In-app purchases | **No** |
| Target age | 13+ |
| Internet required | Yes |

## Data safety declaration

Answer the Play Console Data safety form as follows. Every line matches what the
code actually does — this section exists so the declaration and the app can't
drift apart.

**Data collected and linked to the user (registered accounts only)**
- Email address — App functionality, Account management. Required. Not shared.
- Name (username) — App functionality. Required. Not shared. *Publicly visible on leaderboards.*
- User IDs — App functionality. Required. Not shared.
- Other in-app actions (game stats) — App functionality. Required. Not shared.

**Data collected but NOT linked to the user (guest play)**
- User IDs (temporary guest ID) — App functionality. Required. Not shared.
- Other in-app actions (game stats) — App functionality. Required. Not shared.

**Not collected:** location, financial info, health, photos, videos, audio,
files, contacts, calendar, SMS, call logs, installed apps, device advertising ID.

**Security practices**
- Data is encrypted in transit (TLS for HTTPS and WSS). ✅
- Users can request account deletion via `support@quizroyaleshowdown.app`. ✅
- Passwords are stored only as PBKDF2-SHA256 hashes. ✅

## Before you publish

1. Replace `support@quizroyaleshowdown.app` with a mailbox you monitor — it is set
   in one place, `LEGAL_CONTACT_EMAIL` in `functions/legal.ts`, and appears in both
   legal documents. Play rejects listings whose privacy contact bounces.
2. If you incorporate, update `LEGAL_ENTITY` in the same file.
3. Screenshots and feature graphic are still required (see the
   `play-store-assets` skill).
