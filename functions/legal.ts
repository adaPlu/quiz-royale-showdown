// functions/legal.ts — publicly hosted legal documents.
//
// These are served from the Worker rather than a separate static host for one
// practical reason: Google Play Console requires a *publicly reachable* privacy
// policy URL, and this backend is already deployed at a stable domain. No auth,
// no CORS restrictions, no JavaScript — so Play's crawler, Apple's reviewer and
// a regular browser all see the same document.
//
// Routes:
//   GET /legal            index linking to all documents
//   GET /legal/privacy    Privacy Policy
//   GET /legal/terms      Terms and Conditions
//   GET /legal/eula       redirect to Apple's Standard EULA
//
// The content below is written to match what the code ACTUALLY does. Anything
// the app does not do (ads, tracking SDKs, data selling) is stated as such,
// because an inaccurate privacy policy is worse than none at all.

/**
 * The single contact address published in both documents.
 * Changing this value updates the Privacy Policy, the Terms, and the legal index
 * together, so the store listing and the hosted documents can never disagree.
 */
export const LEGAL_CONTACT_EMAIL = "quizroyaleshowdown@gmail.com";

/** Legal entity named as the data controller. Replace if you incorporate. */
export const LEGAL_ENTITY = "the Quiz Royale Showdown team";

export const LEGAL_EFFECTIVE_DATE = "15 August 2026";

/** Apple's Standard EULA (the "Licensed Application End User License Agreement"). */
export const APPLE_STANDARD_EULA_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

// --------------------------------------------------------------- privacy policy

const PRIVACY_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "Who we are",
    body: [
      `Quiz Royale Showdown ("the app") is a real-time multiplayer trivia game operated by ${LEGAL_ENTITY} ("we", "us"). This policy explains exactly what we collect, why, and how long we keep it.`,
      `For questions about this policy or to exercise any right described below, contact <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>.`,
    ],
  },
  {
    heading: "The short version",
    body: [
      "You can play without giving us any personal information at all. Guest play requires no email, no password and no account.",
      "We do not sell your data. We do not share it with advertisers. The app contains no advertising SDKs, no analytics SDKs and no third-party trackers.",
      "If you register, we store your username, email address and a cryptographic hash of your password — never the password itself.",
    ],
  },
  {
    heading: "What we collect when you play as a guest",
    body: [
      "Guest play is deliberately anonymous. When you open the app we issue a temporary guest identifier (for example <code>g1042-8fe1c3</code>) that is not linked to your name, email, phone number or device advertising identifier.",
      "Attached to that temporary identifier we store only competitive game data: matches played, wins, losses, points, correct answers, power-up charges and per-category scores.",
      "We also store a randomly generated installation identifier on your device. It is used to place you into a match lobby and is not derived from any hardware identifier.",
      "A guest identifier expires after 30 minutes of inactivity. On expiry the identifier and all statistics attached to it are permanently deleted from our systems and the identifier slot is recycled for reuse. Guest data is not recoverable after expiry, by us or by you.",
    ],
  },
  {
    heading: "What we collect when you register an account",
    body: [
      "<strong>Username</strong> — shown publicly on leaderboards, in matches and to your friends.",
      "<strong>Email address</strong> — used to identify your account at sign-in and for essential account correspondence. It is never shown to other players.",
      "<strong>Password</strong> — we never store your password. We store a PBKDF2-SHA256 hash with a unique random salt per account. We cannot read, recover or tell you your password.",
      "<strong>Game statistics</strong> — the same competitive counters listed above, retained for as long as your account exists.",
      "<strong>Friends</strong> — the usernames of accounts you add as friends, and the fact that they added you.",
      "<strong>Presence</strong> — a timestamp of your last activity and whether you are currently in a match. This is visible only to players on your friends list and is never public.",
      "<strong>Session tokens</strong> — when you sign in we issue a random session token. We store only a SHA-256 digest of it, so a copy of our database cannot be used to impersonate you.",
    ],
  },
  {
    heading: "What we deliberately do not collect",
    body: [
      "No real name, date of birth, postal address or phone number.",
      "No precise or coarse location data.",
      "No contacts, photos, camera, microphone or file access. The app requests no such permissions.",
      "No advertising identifier, and no cross-app or cross-site tracking.",
      "No payment information. The app currently contains no purchases or subscriptions.",
    ],
  },
  {
    heading: "Transferring guest progress to an account",
    body: [
      "If you register while playing as a guest you may optionally transfer that session's statistics to your new account. This is opt-in via a checkbox on the registration screen and is off by default.",
      "The transfer is one-time and irreversible: the guest identifier is retired in the same operation, so the same session cannot be transferred twice.",
      "If you decline, the guest statistics are left to expire and are deleted on the normal 30-minute inactivity schedule.",
    ],
  },
  {
    heading: "What other players can see",
    body: [
      "Your username, points and win count appear on public leaderboards. Guest entries are additionally marked as temporary and are removed when the guest identifier expires.",
      "Players in your match see your display name, score, streak and elimination status.",
      "Only people on your friends list can see your online status and whether you are in a match. Your email address is never visible to anyone.",
    ],
  },
  {
    heading: "Where your data is processed",
    body: [
      "Game state, accounts and leaderboards are hosted on Cloudflare's global network (Cloudflare Workers and Durable Objects). Data may be processed in any region where Cloudflare operates, including outside your country of residence.",
      "Cloudflare acts as our infrastructure processor and does not use your data for its own purposes. Their sub-processor terms are available on cloudflare.com.",
      "Transport is encrypted with TLS (HTTPS and WSS) for every request and match connection.",
    ],
  },
  {
    heading: "How long we keep things",
    body: [
      "<strong>Guest data</strong> — deleted 30 minutes after your last activity.",
      "<strong>Account data</strong> — kept until you ask us to delete it.",
      "<strong>Session tokens</strong> — expire 30 days after last use, and immediately when you sign out.",
      "<strong>Match state</strong> — transient; discarded shortly after a match finishes.",
    ],
  },
  {
    heading: "Your rights",
    body: [
      "You can request a copy of your data, correction of it, or its deletion, by emailing us from the address registered to your account. We respond within 30 days.",
      "Deleting your account removes your profile, email, password hash, statistics, friend connections and leaderboard entries.",
      "Depending on where you live you may also have the right to object to processing, to restrict it, or to complain to your local data protection authority. Nothing in this policy limits those rights.",
      "You can avoid giving us any personal data at all by continuing to play as a guest.",
    ],
  },
  {
    heading: "Children",
    body: [
      "The app is not directed at children under 13, and we do not knowingly collect personal information from them. If you believe a child has registered an account, contact us and we will delete it.",
    ],
  },
  {
    heading: "Security",
    body: [
      "Passwords are hashed with PBKDF2-SHA256 using 400,000 effective iterations and a unique per-account salt, and verified in constant time.",
      "All game outcomes, scores and eliminations are computed on our servers. The app cannot report its own results, which protects both fair play and the integrity of your record.",
      "No system is perfectly secure. If we become aware of a breach affecting your personal data we will notify affected users and any required regulator without undue delay.",
    ],
  },
  {
    heading: "Changes",
    body: [
      "If we change this policy materially — for example by adding purchases or a third-party service — we will update the effective date and surface the change in the app before it takes effect.",
    ],
  },
];

// ------------------------------------------------------------------------ terms

const TERMS_SECTIONS: { heading: string; body: string[] }[] = [
  {
    heading: "1. Agreement",
    body: [
      `These Terms and Conditions ("Terms") govern your use of Quiz Royale Showdown ("the app"), operated by ${LEGAL_ENTITY}. By installing or using the app you accept these Terms. If you do not accept them, do not use the app.`,
      "If you obtained the app from a platform such as Google Play or the Apple App Store, that platform's own terms also apply to your download and to any purchase made through it.",
    ],
  },
  {
    heading: "2. Licence",
    body: [
      "We grant you a personal, non-exclusive, non-transferable, revocable licence to install and use the app on devices you own or control, for your own non-commercial entertainment.",
      "You may not copy, modify, reverse engineer, decompile, resell or redistribute the app or any part of it, except where that restriction is prohibited by law.",
      "We retain all intellectual property rights in the app, including its trivia content, artwork, name and branding.",
    ],
  },
  {
    heading: "3. Guest play and accounts",
    body: [
      "You may play as a guest without registering. A guest identifier is temporary: it expires after 30 minutes of inactivity, and all statistics attached to it are permanently deleted at that point. Guest progress is not a durable record and we make no commitment to preserve it.",
      "Registering creates a durable account. You are responsible for keeping your password confidential and for activity that occurs under your account.",
      "One person per account. Do not share credentials, and do not register accounts on behalf of others.",
      "Choose a username that is not offensive, impersonating, or infringing. We may rename or remove usernames that breach this.",
    ],
  },
  {
    heading: "4. Fair play",
    body: [
      "All scoring, eliminations and rankings are determined by our servers and are final.",
      "You must not attempt to manipulate results — including by modifying the app, intercepting or forging network traffic, automating answers, exploiting bugs, or operating multiple accounts to influence a match or leaderboard.",
      "We may reset statistics, remove leaderboard entries, or suspend or terminate accounts that we reasonably believe have breached this section. Where practical we will tell you why.",
    ],
  },
  {
    heading: "5. Conduct",
    body: [
      "Do not use the app to harass, threaten or abuse other players, or to submit unlawful, hateful or infringing content in any free-text field such as a display name.",
      "Do not attempt to gain unauthorised access to our systems, other players' accounts, or any data you are not entitled to.",
      "Do not interfere with the availability of the service, for example by flooding it with automated requests.",
    ],
  },
  {
    heading: "6. Trivia content",
    body: [
      "Questions and answers are provided for entertainment. We aim for accuracy but do not warrant that any question, answer or category is correct, current or complete, and nothing in the app is professional or educational advice.",
      "If you believe a question is wrong, tell us and we will review it.",
    ],
  },
  {
    heading: "7. Purchases",
    body: [
      "The app currently contains no purchases, subscriptions or virtual currency, and no payment information is collected.",
      "If we later introduce paid features, the price, billing period and renewal terms will be disclosed in the app before you are charged, and billing will be handled by the platform store rather than by us. Refunds are governed by that platform's policy. On Apple platforms, purchases are additionally subject to Apple's Licensed Application End User License Agreement (the Standard EULA).",
    ],
  },
  {
    heading: "8. Availability",
    body: [
      "The app is an online service and depends on your internet connection. We do not guarantee uninterrupted availability, and we may modify, suspend or discontinue features — including matchmaking, leaderboards or the service as a whole — at any time.",
      "We may update the app for security, compatibility or improvement. Some updates may be required in order to keep playing.",
    ],
  },
  {
    heading: "9. Termination",
    body: [
      "You may stop using the app at any time, and may request deletion of your account by contacting us.",
      "We may suspend or terminate your access for breach of these Terms, or where required by law. Sections that by their nature should survive termination — licence restrictions, disclaimers and limitation of liability — continue to apply.",
    ],
  },
  {
    heading: "10. Disclaimers and liability",
    body: [
      'The app is provided "as is" and "as available". To the fullest extent permitted by law we disclaim all implied warranties, including fitness for a particular purpose and uninterrupted or error-free operation.',
      "To the fullest extent permitted by law we are not liable for indirect, incidental, special or consequential losses, for lost data, or for loss of guest progress that expires as described in these Terms.",
      "Nothing in these Terms excludes or limits liability that cannot lawfully be excluded — including for death or personal injury caused by negligence, or for fraud. If you are a consumer, your statutory rights are unaffected.",
    ],
  },
  {
    heading: "11. Privacy",
    body: [
      'Our handling of personal data is described in the Privacy Policy, which forms part of these Terms.',
    ],
  },
  {
    heading: "12. Changes and contact",
    body: [
      "We may update these Terms. If a change is material we will surface it in the app before it takes effect; continuing to use the app after that constitutes acceptance.",
      `Questions: <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a>.`,
    ],
  },
];

// ----------------------------------------------------------------- presentation

/**
 * Inlined dark-theme styling matching the app's Arena palette. Self-contained on
 * purpose: no external stylesheet or font request, so the page renders instantly
 * for a store reviewer on a slow connection and has nothing to fail to load.
 */
const STYLE = `
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 40px 22px 80px;
    background: #0B0E17; color: #F2F5FF;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    -webkit-text-size-adjust: 100%;
  }
  main { max-width: 720px; margin: 0 auto; }
  .eyebrow { color: #FFB020; font-size: 12px; letter-spacing: 2.4px; text-transform: uppercase; font-weight: 800; margin: 0 0 10px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; letter-spacing: -0.4px; }
  .meta { color: #6C7794; font-size: 13px; margin: 0 0 34px; }
  h2 { font-size: 18px; margin: 38px 0 12px; color: #FFC24B; letter-spacing: -0.2px; }
  p { margin: 0 0 13px; color: #A8B2CC; }
  p strong { color: #F2F5FF; }
  code { background: #1E2436; padding: 2px 6px; border-radius: 5px; font-size: 13px; color: #00E5C0; }
  a { color: #00E5C0; }
  hr { border: 0; border-top: 1px solid #2C3450; margin: 44px 0 26px; }
  .nav { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 34px; }
  .nav a {
    text-decoration: none; color: #A8B2CC; border: 1px solid #2C3450;
    padding: 8px 14px; border-radius: 999px; font-size: 14px; background: #151A28;
  }
  .nav a[aria-current="page"] { color: #0B0E17; background: #FFB020; border-color: #FFB020; font-weight: 700; }
  footer { color: #6C7794; font-size: 13px; }
`;

function page(title: string, active: string, sections: { heading: string; body: string[] }[]): string {
  const nav = [
    { href: "/legal/privacy", label: "Privacy Policy", key: "privacy" },
    { href: "/legal/terms", label: "Terms & Conditions", key: "terms" },
    { href: "/legal/eula", label: "EULA", key: "eula" },
  ]
    .map(
      (item) =>
        `<a href="${item.href}"${item.key === active ? ' aria-current="page"' : ""}>${item.label}</a>`,
    )
    .join("");

  const body = sections
    .map(
      (section) =>
        `<h2>${section.heading}</h2>${section.body.map((line) => `<p>${line}</p>`).join("")}`,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Quiz Royale Showdown</title>
<meta name="robots" content="index, follow">
<style>${STYLE}</style>
</head>
<body>
<main>
  <p class="eyebrow">Quiz Royale Showdown</p>
  <h1>${title}</h1>
  <p class="meta">Effective ${LEGAL_EFFECTIVE_DATE}</p>
  <nav class="nav">${nav}</nav>
  ${body}
  <hr>
  <footer>
    <p>Quiz Royale Showdown · <a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a></p>
  </footer>
</main>
</body>
</html>`;
}

function indexPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Legal · Quiz Royale Showdown</title>
<style>${STYLE}</style>
</head>
<body>
<main>
  <p class="eyebrow">Quiz Royale Showdown</p>
  <h1>Legal</h1>
  <p class="meta">Effective ${LEGAL_EFFECTIVE_DATE}</p>
  <h2>Documents</h2>
  <p><a href="/legal/privacy">Privacy Policy</a> — what we collect, and what we deliberately don't.</p>
  <p><a href="/legal/terms">Terms &amp; Conditions</a> — the rules for using the app.</p>
  <p><a href="/legal/eula">End User License Agreement</a> — Apple's Standard EULA.</p>
  <hr>
  <footer><p><a href="mailto:${LEGAL_CONTACT_EMAIL}">${LEGAL_CONTACT_EMAIL}</a></p></footer>
</main>
</body>
</html>`;
}

const HTML_HEADERS: Record<string, string> = {
  "Content-Type": "text/html; charset=utf-8",
  // Cacheable: these documents change rarely and must survive traffic spikes
  // from store review crawlers.
  "Cache-Control": "public, max-age=3600",
  "X-Content-Type-Options": "nosniff",
};

/**
 * Handles any `/legal*` request. Returns null when the path is not a legal
 * route, so the caller can continue matching its other routes.
 */
export function handleLegal(pathname: string): Response | null {
  switch (pathname) {
    case "/legal":
    case "/legal/":
      return new Response(indexPage(), { headers: HTML_HEADERS });

    case "/legal/privacy":
      return new Response(page("Privacy Policy", "privacy", PRIVACY_SECTIONS), {
        headers: HTML_HEADERS,
      });

    case "/legal/terms":
      return new Response(page("Terms and Conditions", "terms", TERMS_SECTIONS), {
        headers: HTML_HEADERS,
      });

    // Apple requires the *canonical* Apple-hosted EULA rather than a copy, so
    // this redirects instead of reproducing the text.
    case "/legal/eula":
      return Response.redirect(APPLE_STANDARD_EULA_URL, 302);

    default:
      return null;
  }
}
