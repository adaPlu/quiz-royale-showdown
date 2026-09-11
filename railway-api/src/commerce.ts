import http from "node:http";
import { createHash, createSign, timingSafeEqual } from "node:crypto";
import { URL } from "node:url";
import { pool, tx, type DbClient } from "./db.js";

type CurrencyKind = "coins" | "gems";
type Balances = { coins: number; gems: number; seasonalTickets: number };
type PaidProduct = { product_id: string; currency: CurrencyKind; amount: number };
type PurchaseReceiptIdentity = { user_id: string; product_id: string };
type PurchaseReceiptRow = PurchaseReceiptIdentity & {
  token_digest: string;
  quantity: number;
  currency: CurrencyKind;
  amount_per_unit: number;
  granted_amount: number;
  reversed_amount: number;
};
type GoogleVoidedPurchase = {
  purchaseToken?: string;
  orderId?: string;
  purchaseTimeMillis?: string;
  voidedTimeMillis?: string;
  voidedSource?: string | number;
  voidedReason?: string | number;
  voidedQuantity?: string | number;
};
type GoogleVoidedPurchasesResponse = {
  voidedPurchases?: GoogleVoidedPurchase[];
  tokenPagination?: { nextPageToken?: string };
};
type CommerceUser = {
  user_id: string;
  currency_balances: unknown;
};
type GoogleProductPurchase = {
  purchaseTimeMillis?: string;
  purchaseState?: number;
  consumptionState?: number;
  orderId?: string;
  purchaseType?: number;
  acknowledgementState?: number;
  productId?: string;
  quantity?: number;
  obfuscatedExternalAccountId?: string;
};
type PubSubPushEnvelope = {
  message?: {
    data?: string;
    messageId?: string;
    publishTime?: string;
  };
  subscription?: string;
};
type PendingRefundReviewNotification = {
  version?: string;
  pendingRefundToken?: string;
  orderId?: string;
  refundReason?: number;
  obfuscatedAccountId?: string;
  obfuscatedProfileId?: string;
};
export type RtdnPayload = {
  version?: string;
  packageName?: string;
  eventTimeMillis?: string;
  oneTimeProductNotification?: unknown;
  voidedPurchaseNotification?: unknown;
  pendingRefundReviewNotification?: PendingRefundReviewNotification;
  subscriptionNotification?: unknown;
  testNotification?: unknown;
};
type RefundPreference = "APPROVE" | "DECLINE" | "NEUTRAL";
type ConsumptionUsageEvent = {
  obfuscatedAccountId?: string;
  obfuscatedProfileId?: string;
  consumptionTime?: string;
  ipAddress?: string;
  consumptionItemDescription?: string;
  location?: {
    regionCode: string;
    administrativeArea?: string;
    locality?: string;
    sublocality?: string;
  };
};
type PendingRefundReviewRow = {
  pending_refund_token: string;
  review_id: string;
  order_id: string;
  refund_reason: number | null;
  obfuscated_account_id: string | null;
  obfuscated_profile_id: string | null;
  event_time: string | number | null;
  received_at: string | number;
  deadline_at: string | number;
  status: "PENDING" | "SUBMITTING" | "FAILED" | "COMPLETED";
  decision: RefundPreference | null;
  sample_content_provided: boolean | null;
  consumption_percentage_milliunits: number | null;
  consumption_usage_events: unknown;
  submit_attempts: number;
  google_status: number | null;
  google_response: unknown;
  last_attempt_at: string | number | null;
  completed_at: string | number | null;
  last_alert_at: string | number | null;
  updated_at: string | number;
};
type GoogleTokenInfo = {
  aud?: string;
  email?: string;
  email_verified?: string;
  exp?: string;
  iss?: string;
};
type ServiceAccount = {
  client_email: string;
  private_key: string;
  token_uri?: string;
};
type ApiResult = { status: number; body: unknown };
type GrantSuccess = {
  ok: true;
  duplicate: boolean;
  productId: string;
  currency?: CurrencyKind;
  grantedAmount?: number;
  balances: Balances;
};
type GrantFailure = { ok: false; status: number; body: unknown };

const PACKAGE_NAME = process.env.GOOGLE_PLAY_PACKAGE_NAME?.trim() || "com.rork.quizroyaleshowdown";
const MAX_BODY = 32 * 1024;
const PLAY_SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const DEFAULT_ORIGINS = new Set([
  "https://quizroyale.gg",
  "https://www.quizroyale.gg",
  "https://play.quizroyale.gg",
  "https://quiz-royale-showdown.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
]);
const PAGES_HOST = "quiz-royale-showdown.pages.dev";
const VOIDED_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_VOIDED_RECONCILE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const REFUND_REVIEW_WINDOW_MS = 24 * 60 * 60 * 1000;
const REFUND_REVIEW_ALERT_THRESHOLD_MS = 4 * 60 * 60 * 1000;
const REFUND_REVIEW_ALERT_REPEAT_MS = 60 * 60 * 1000;
const DEFAULT_REFUND_REVIEW_ALERT_INTERVAL_MS = 15 * 60 * 1000;

let accessTokenCache: { token: string; expiresAt: number } | null = null;

export function startGooglePlayVoidedPurchaseReconciler(): () => void {
  if (process.env.NODE_ENV === "test" || process.env.GOOGLE_PLAY_VOIDED_RECONCILIATION === "false") {
    return () => undefined;
  }

  const configured = Number.parseInt(process.env.GOOGLE_PLAY_VOIDED_RECONCILE_INTERVAL_MS ?? "", 10);
  const intervalMs = Number.isFinite(configured) && configured >= 60_000
    ? configured
    : DEFAULT_VOIDED_RECONCILE_INTERVAL_MS;

  const run = () => {
    reconcileVoidedPurchases().catch((error) => {
      console.error("Google Play voided purchase reconciliation failed", (error as Error)?.message);
    });
  };

  const initial = setTimeout(run, 30_000);
  initial.unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();

  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}

export function startGooglePlayPendingRefundReviewAlerting(): () => void {
  if (process.env.NODE_ENV === "test" || process.env.GOOGLE_PLAY_REFUND_REVIEW_ALERTS === "false") {
    return () => undefined;
  }

  const configured = Number.parseInt(process.env.GOOGLE_PLAY_REFUND_REVIEW_ALERT_INTERVAL_MS ?? "", 10);
  const intervalMs = Number.isFinite(configured) && configured >= 60_000
    ? configured
    : DEFAULT_REFUND_REVIEW_ALERT_INTERVAL_MS;

  const run = () => {
    alertPendingRefundReviews().catch((error) => {
      console.error("Google Play pending refund review alert check failed", (error as Error)?.message);
    });
  };

  const initial = setTimeout(run, 45_000);
  initial.unref?.();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();

  return () => {
    clearTimeout(initial);
    clearInterval(timer);
  };
}

async function alertPendingRefundReviews(now = Date.now()): Promise<void> {
  const rows = await pool.query<Pick<PendingRefundReviewRow, "review_id" | "order_id" | "deadline_at" | "status">>(
    `SELECT review_id, order_id, deadline_at, status
     FROM play_pending_refund_reviews
     WHERE status <> 'COMPLETED'
       AND deadline_at <= $1
       AND (last_alert_at IS NULL OR last_alert_at <= $2)
     ORDER BY deadline_at ASC
     LIMIT 100`,
    [now + REFUND_REVIEW_ALERT_THRESHOLD_MS, now - REFUND_REVIEW_ALERT_REPEAT_MS],
  );

  for (const row of rows.rows) {
    const deadlineAt = Number(row.deadline_at);
    const state = refundReviewDeadlineState(deadlineAt, now);
    if (state === "overdue") {
      console.error("Google Play pending refund review requires operator attention", {
        reviewId: row.review_id,
        orderId: row.order_id,
        status: row.status,
        deadlineAt,
        deadlineState: state,
      });
    } else {
      console.warn("Google Play pending refund review requires operator attention", {
        reviewId: row.review_id,
        orderId: row.order_id,
        status: row.status,
        deadlineAt,
        deadlineState: state,
      });
    }
    await pool.query(
      "UPDATE play_pending_refund_reviews SET last_alert_at = $2, updated_at = GREATEST(updated_at, $2) WHERE review_id = $1",
      [row.review_id, now],
    );
  }
}

export async function reconcileVoidedPurchases(now = Date.now()): Promise<Record<string, unknown>> {
  const credentials = serviceAccount();
  if (!credentials) {
    return { ok: false, error: "billing_not_configured", processed: 0, reversed: 0 };
  }

  const accessToken = await googleAccessToken(credentials);
  let pageToken: string | null = null;
  let processed = 0;
  let reversed = 0;
  let duplicates = 0;
  let unmatched = 0;
  let pages = 0;

  do {
    const endpoint = new URL(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/voidedpurchases`,
    );
    endpoint.searchParams.set("startTime", String(Math.max(0, now - VOIDED_LOOKBACK_MS)));
    endpoint.searchParams.set("endTime", String(now));
    endpoint.searchParams.set("type", "0");
    endpoint.searchParams.set("includeQuantityBasedPartialRefund", "true");
    endpoint.searchParams.set("maxResults", "1000");
    if (pageToken) endpoint.searchParams.set("token", pageToken);

    const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
    const text = await response.text();
    if (!response.ok) {
      console.warn("Google Play voided purchase query failed", response.status, text.slice(0, 300));
      throw new Error(`Google Play voided purchases returned ${response.status}`);
    }

    let payload: GoogleVoidedPurchasesResponse = {};
    try {
      payload = text ? JSON.parse(text) as GoogleVoidedPurchasesResponse : {};
    } catch {
      throw new Error("Google Play voided purchases returned invalid JSON");
    }

    for (const event of payload.voidedPurchases ?? []) {
      if (!event.purchaseToken) continue;
      processed += 1;
      const result = await reverseVoidedPurchase(event, now);
      if (result === "reversed") reversed += 1;
      else if (result === "duplicate") duplicates += 1;
      else unmatched += 1;
    }

    pageToken = payload.tokenPagination?.nextPageToken?.trim() || null;
    pages += 1;
  } while (pageToken && pages < 20);

  return { ok: true, processed, reversed, duplicates, unmatched, pages };
}

async function reverseVoidedPurchase(
  event: GoogleVoidedPurchase,
  now: number,
): Promise<"reversed" | "duplicate" | "unmatched"> {
  const token = event.purchaseToken?.trim();
  if (!token) return "unmatched";
  const tokenDigest = sha256(token);
  const eventKey = sha256([
    tokenDigest,
    event.orderId ?? "",
    event.voidedTimeMillis ?? "",
    event.voidedQuantity ?? "FULL",
    event.voidedReason ?? "",
    event.voidedSource ?? "",
  ].join(":"));

  return tx(async (client) => {
    const receiptResult = await client.query<PurchaseReceiptRow>(
      `SELECT token_digest, user_id, product_id, quantity, currency, amount_per_unit,
              granted_amount, COALESCE(reversed_amount, 0) AS reversed_amount
       FROM play_purchase_receipts
       WHERE token_digest = $1
       FOR UPDATE`,
      [tokenDigest],
    );
    const receipt = receiptResult.rows[0];
    if (!receipt) return "unmatched" as const;

    const seen = await client.query("SELECT 1 FROM play_purchase_voids WHERE event_key = $1", [eventKey]);
    if (seen.rowCount) return "duplicate" as const;

    const user = await getCommerceUser(client, receipt.user_id, true);
    if (!user) return "unmatched" as const;

    const voidedQuantity = optionalPositiveInt(event.voidedQuantity);
    const amount = voidReversalAmount(
      Number(receipt.granted_amount),
      Number(receipt.amount_per_unit),
      Number(receipt.reversed_amount),
      voidedQuantity,
    );
    const balances = normalizeBalances(user.currency_balances);
    const next = { ...balances, [receipt.currency]: balances[receipt.currency] - amount };
    const voidedAt = parseMillis(String(event.voidedTimeMillis ?? "")) ?? now;
    const reason = optionalInt(event.voidedReason);
    const source = optionalInt(event.voidedSource);

    if (amount > 0) {
      await client.query(
        "UPDATE users SET currency_balances = $2 WHERE user_id = $1",
        [receipt.user_id, JSON.stringify(next)],
      );
      await client.query(
        `INSERT INTO currency_ledger(
          ledger_id, user_id, currency, delta, balance_after, reason, reference_id, created_at
        ) VALUES ($1,$2,$3,$4,$5,'google_play_void',$6,$7)
        ON CONFLICT DO NOTHING`,
        [
          `cl-void-${eventKey.slice(0, 40)}`,
          receipt.user_id,
          receipt.currency,
          -amount,
          next[receipt.currency],
          eventKey,
          now,
        ],
      );
    }

    await client.query(
      `INSERT INTO play_purchase_voids(
        event_key, token_digest, user_id, product_id, voided_at, voided_quantity,
        voided_reason, voided_source, reversed_amount, processed_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        eventKey,
        tokenDigest,
        receipt.user_id,
        receipt.product_id,
        voidedAt,
        voidedQuantity,
        reason,
        source,
        amount,
        now,
      ],
    );
    await client.query(
      `UPDATE play_purchase_receipts
       SET reversed_amount = LEAST(granted_amount, COALESCE(reversed_amount, 0) + $2),
           voided_at = GREATEST(COALESCE(voided_at, 0), $3),
           voided_reason = COALESCE($4, voided_reason),
           voided_source = COALESCE($5, voided_source)
       WHERE token_digest = $1`,
      [tokenDigest, amount, voidedAt, reason, source],
    );

    return amount > 0 ? "reversed" as const : "duplicate" as const;
  });
}

export function voidReversalAmount(
  grantedAmount: number,
  amountPerUnit: number,
  alreadyReversed: number,
  voidedQuantity: number | null = null,
): number {
  const remaining = Math.max(0, Math.floor(grantedAmount) - Math.max(0, Math.floor(alreadyReversed)));
  if (remaining === 0) return 0;
  if (voidedQuantity === null) return remaining;
  const requested = Math.max(0, Math.floor(amountPerUnit)) * Math.max(0, Math.floor(voidedQuantity));
  return Math.min(remaining, requested);
}

export async function handleCommerceRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const isCommerceRoute =
    url.pathname === "/store/currency-packs" ||
    url.pathname === "/store/google-play/verify" ||
    url.pathname === "/internal/billing-status" ||
    url.pathname === "/internal/google-play/reconcile-voided" ||
    url.pathname === "/internal/google-play/pending-refund-reviews" ||
    url.pathname === "/internal/google-play/review-refund" ||
    url.pathname === "/google-play/rtdn";
  if (!isCommerceRoute) return false;

  const origin = typeof request.headers.origin === "string" ? request.headers.origin.trim().replace(/\/$/, "") : "";
  if (origin && !isAllowedOrigin(origin)) {
    send(response, 403, { error: "origin_not_allowed" });
    return true;
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Token");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return true;
  }

  try {
    if (request.method === "POST" && url.pathname === "/google-play/rtdn") {
      return finish(response, await handleGooglePlayRtdn(request));
    }

    if (request.method === "GET" && url.pathname === "/internal/billing-status") {
      if (!authorizedInternal(request)) {
        return finish(response, { status: 401, body: { error: "unauthorized" } });
      }
      return finish(response, { status: 200, body: billingStatus() });
    }

    if (request.method === "POST" && url.pathname === "/internal/google-play/reconcile-voided") {
      if (!authorizedInternal(request)) {
        return finish(response, { status: 401, body: { error: "unauthorized" } });
      }
      return finish(response, { status: 200, body: await reconcileVoidedPurchases() });
    }

    if (request.method === "GET" && url.pathname === "/internal/google-play/pending-refund-reviews") {
      if (!authorizedInternal(request)) {
        return finish(response, { status: 401, body: { error: "unauthorized" } });
      }
      return finish(response, { status: 200, body: await listPendingRefundReviews() });
    }

    if (request.method === "POST" && url.pathname === "/internal/google-play/review-refund") {
      if (!authorizedInternal(request)) {
        return finish(response, { status: 401, body: { error: "unauthorized" } });
      }
      return finish(response, await submitPendingRefundReview(request));
    }

    if (request.method === "GET" && url.pathname === "/store/currency-packs") {
      const user = await authenticate(request);
      if (!user) return finish(response, { status: 401, body: { error: "unauthorized" } });
      const products = await pool.query<PaidProduct>(
        `SELECT product_id, currency, amount
         FROM paid_currency_products
         WHERE active = true
         ORDER BY sort_order, product_id`,
      );
      return finish(response, {
        status: 200,
        body: {
          products: products.rows.map((row) => ({
            productId: row.product_id,
            currency: row.currency,
            amount: Number(row.amount),
          })),
          balances: normalizeBalances(user.currency_balances),
          platform: "google_play",
          accountBinding: accountBinding(user.user_id),
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/store/google-play/verify") {
      const user = await authenticate(request);
      if (!user) return finish(response, { status: 401, body: { error: "unauthorized" } });
      return finish(response, await verifyAndGrant(request, user));
    }

    return finish(response, { status: 405, body: { error: "method_not_allowed" } });
  } catch (error) {
    console.error("commerce request failed", (error as Error)?.message);
    const statusCode = (error as { statusCode?: number })?.statusCode;
    if (statusCode === 413) {
      return finish(response, { status: 413, body: { error: "payload_too_large" } });
    }
    return finish(response, { status: 500, body: { error: "commerce_internal_error", message: "Purchase verification failed." } });
  }
}

async function handleGooglePlayRtdn(request: http.IncomingMessage): Promise<ApiResult> {
  const expectedAudience = process.env.GOOGLE_PLAY_RTDN_AUDIENCE?.trim();
  const expectedEmail = process.env.GOOGLE_PLAY_RTDN_SERVICE_ACCOUNT_EMAIL?.trim().toLowerCase();
  if (!expectedAudience || !expectedEmail) {
    return {
      status: 503,
      body: { error: "rtdn_not_configured", message: "Authenticated Google Play RTDN is not configured." },
    };
  }

  const authorization = headerValue(request, "authorization")?.trim() ?? "";
  if (!authorization.startsWith("Bearer ")) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const token = authorization.slice(7).trim();
  if (!token || token.length > 16_384) {
    return { status: 401, body: { error: "unauthorized" } };
  }

  const identity = await verifyGooglePushToken(token, expectedAudience, expectedEmail);
  if (!identity) return { status: 401, body: { error: "unauthorized" } };

  const rawEnvelope = await readJson(request);
  const envelope = rawEnvelope as PubSubPushEnvelope;
  const messageId = typeof envelope.message?.messageId === "string"
    ? envelope.message.messageId.trim().slice(0, 200)
    : "";
  const encoded = typeof envelope.message?.data === "string" ? envelope.message.data.trim() : "";
  if (!messageId || !encoded || encoded.length > 32_000) {
    return { status: 400, body: { error: "invalid_pubsub_message" } };
  }

  let payload: RtdnPayload;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    payload = JSON.parse(decoded) as RtdnPayload;
  } catch {
    return { status: 400, body: { error: "invalid_rtdn_payload" } };
  }

  if (payload.packageName !== PACKAGE_NAME) {
    // Authenticated Pub/Sub messages for a different package are acknowledged
    // but ignored so a subscription mistake cannot create an infinite retry.
    return { status: 200, body: { ok: true, ignored: "package_mismatch" } };
  }

  const eventKind = rtdnEventKind(payload);
  if (eventKind === "pending_refund_review" && !normalizePendingRefundReview(payload.pendingRefundReviewNotification)) {
    return { status: 400, body: { error: "invalid_pending_refund_review" } };
  }

  const recorded = await recordRtdnEvent(messageId, payload);
  if (recorded.duplicate) return { status: 200, body: { ok: true, duplicate: true } };

  // A pending refund review is not yet a voided purchase. Queue it for an
  // explicit operator decision instead of acknowledging it as if the outcome
  // were already final. Other purchase lifecycle signals retain the existing
  // authenticated voided-purchase reconciliation behavior.
  if (eventKind !== "pending_refund_review" && eventKind !== "test") {
    await reconcileVoidedPurchases();
  }
  return {
    status: 200,
    body: { ok: true, eventKind, ...(recorded.reviewId ? { reviewId: recorded.reviewId } : {}) },
  };
}

export function rtdnEventKind(payload: RtdnPayload): string {
  if (payload.voidedPurchaseNotification) return "voided_purchase";
  if (payload.pendingRefundReviewNotification) return "pending_refund_review";
  if (payload.oneTimeProductNotification) return "one_time_product";
  if (payload.subscriptionNotification) return "subscription";
  if (payload.testNotification) return "test";
  return "unknown";
}

export async function recordRtdnEvent(
  messageId: string,
  payload: RtdnPayload,
  receivedAt = Date.now(),
): Promise<{ duplicate: boolean; eventKind: string; reviewId?: string }> {
  const eventKind = rtdnEventKind(payload);
  const eventTime = parseMillis(payload.eventTimeMillis);

  return tx(async (client) => {
    const inserted = await client.query(
      `INSERT INTO play_rtdn_events(message_id, package_name, event_kind, event_time, received_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (message_id) DO NOTHING
       RETURNING message_id`,
      [messageId, PACKAGE_NAME, eventKind, eventTime, receivedAt],
    );
    if (!inserted.rowCount) return { duplicate: true, eventKind };

    if (eventKind !== "pending_refund_review") return { duplicate: false, eventKind };
    const pending = normalizePendingRefundReview(payload.pendingRefundReviewNotification);
    if (!pending) throw new Error("invalid pending refund review payload");

    const reviewId = `refund-${sha256(pending.pendingRefundToken).slice(0, 32)}`;
    const deadlineBase = eventTime && eventTime <= receivedAt + 5 * 60 * 1000 ? eventTime : receivedAt;
    const deadlineAt = deadlineBase + REFUND_REVIEW_WINDOW_MS;

    await client.query(
      `INSERT INTO play_pending_refund_reviews(
         pending_refund_token, review_id, order_id, refund_reason,
         obfuscated_account_id, obfuscated_profile_id, event_time,
         received_at, deadline_at, status, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $8)
       ON CONFLICT (pending_refund_token)
       DO UPDATE SET
         order_id = EXCLUDED.order_id,
         refund_reason = COALESCE(EXCLUDED.refund_reason, play_pending_refund_reviews.refund_reason),
         obfuscated_account_id = COALESCE(EXCLUDED.obfuscated_account_id, play_pending_refund_reviews.obfuscated_account_id),
         obfuscated_profile_id = COALESCE(EXCLUDED.obfuscated_profile_id, play_pending_refund_reviews.obfuscated_profile_id),
         event_time = COALESCE(LEAST(play_pending_refund_reviews.event_time, EXCLUDED.event_time), play_pending_refund_reviews.event_time, EXCLUDED.event_time),
         received_at = LEAST(play_pending_refund_reviews.received_at, EXCLUDED.received_at),
         deadline_at = LEAST(play_pending_refund_reviews.deadline_at, EXCLUDED.deadline_at),
         updated_at = GREATEST(play_pending_refund_reviews.updated_at, EXCLUDED.updated_at)`,
      [
        pending.pendingRefundToken,
        reviewId,
        pending.orderId,
        pending.refundReason,
        pending.obfuscatedAccountId,
        pending.obfuscatedProfileId,
        eventTime,
        receivedAt,
        deadlineAt,
      ],
    );

    return { duplicate: false, eventKind, reviewId };
  });
}

function normalizePendingRefundReview(
  raw: PendingRefundReviewNotification | undefined,
): {
  pendingRefundToken: string;
  orderId: string;
  refundReason: number | null;
  obfuscatedAccountId: string | null;
  obfuscatedProfileId: string | null;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const pendingRefundToken = typeof raw.pendingRefundToken === "string" ? raw.pendingRefundToken.trim() : "";
  const orderId = typeof raw.orderId === "string" ? raw.orderId.trim() : "";
  if (!pendingRefundToken || pendingRefundToken.length > 4096 || !orderId || orderId.length > 256) return null;

  return {
    pendingRefundToken,
    orderId,
    refundReason: typeof raw.refundReason === "number" && Number.isInteger(raw.refundReason) ? raw.refundReason : null,
    obfuscatedAccountId: boundedOptionalString(raw.obfuscatedAccountId, 256),
    obfuscatedProfileId: boundedOptionalString(raw.obfuscatedProfileId, 256),
  };
}

async function listPendingRefundReviews(now = Date.now()): Promise<Record<string, unknown>> {
  const result = await pool.query<PendingRefundReviewRow>(
    `SELECT review_id, order_id, refund_reason, obfuscated_account_id, obfuscated_profile_id,
            event_time, received_at, deadline_at, status, decision,
            sample_content_provided, consumption_percentage_milliunits,
            consumption_usage_events, submit_attempts, google_status,
            last_attempt_at, completed_at, updated_at
     FROM play_pending_refund_reviews
     WHERE status <> 'COMPLETED'
     ORDER BY deadline_at ASC, received_at ASC
     LIMIT 500`,
  );

  return {
    reviews: result.rows.map((row) => {
      const deadlineAt = Number(row.deadline_at);
      return {
        reviewId: row.review_id,
        orderId: row.order_id,
        refundReason: row.refund_reason,
        obfuscatedAccountId: row.obfuscated_account_id,
        obfuscatedProfileId: row.obfuscated_profile_id,
        eventTime: row.event_time === null ? null : Number(row.event_time),
        receivedAt: Number(row.received_at),
        deadlineAt,
        deadlineState: refundReviewDeadlineState(deadlineAt, now),
        millisecondsRemaining: Math.max(0, deadlineAt - now),
        status: row.status,
        decision: row.decision,
        submitAttempts: Number(row.submit_attempts),
        googleStatus: row.google_status,
        lastAttemptAt: row.last_attempt_at === null ? null : Number(row.last_attempt_at),
        updatedAt: Number(row.updated_at),
      };
    }),
  };
}

export function refundReviewDeadlineState(
  deadlineAt: number,
  now = Date.now(),
): "open" | "due_soon" | "overdue" {
  if (deadlineAt <= now) return "overdue";
  if (deadlineAt - now <= REFUND_REVIEW_ALERT_THRESHOLD_MS) return "due_soon";
  return "open";
}

async function submitPendingRefundReview(request: http.IncomingMessage): Promise<ApiResult> {
  const body = await readJson(request);
  const reviewId = typeof body.reviewId === "string" ? body.reviewId.trim() : "";
  const refundPreference = normalizeRefundPreference(body.refundPreference);
  const sampleContentProvided = typeof body.sampleContentProvided === "boolean"
    ? body.sampleContentProvided
    : null;
  const consumptionPercentageMilliunits = optionalInt(body.consumptionPercentageMilliunits);
  const usageEvents = normalizeConsumptionUsageEvents(body.consumptionUsageEvents);

  if (!reviewId || reviewId.length > 80 || !refundPreference || sampleContentProvided === null) {
    return { status: 400, body: { error: "validation_failed", message: "Review ID, refund preference, and sample-content flag are required." } };
  }
  if (
    consumptionPercentageMilliunits !== null &&
    (consumptionPercentageMilliunits < 0 || consumptionPercentageMilliunits > 100_000)
  ) {
    return { status: 400, body: { error: "validation_failed", message: "Consumption percentage must be between 0 and 100000 milliunits." } };
  }
  if (body.consumptionUsageEvents !== undefined && usageEvents === null) {
    return { status: 400, body: { error: "validation_failed", message: "Consumption usage evidence is invalid." } };
  }

  const evidence = usageEvents ?? [];
  const existing = await pool.query<PendingRefundReviewRow>(
    "SELECT * FROM play_pending_refund_reviews WHERE review_id = $1",
    [reviewId],
  );
  const current = existing.rows[0];
  if (!current) return { status: 404, body: { error: "review_not_found" } };

  if (current.status === "COMPLETED") {
    if (sameReviewSubmission(current, refundPreference, sampleContentProvided, consumptionPercentageMilliunits, evidence)) {
      return {
        status: 200,
        body: {
          ok: true,
          duplicate: true,
          reviewId,
          decision: current.decision,
          completedAt: current.completed_at === null ? null : Number(current.completed_at),
        },
      };
    }
    return { status: 409, body: { error: "review_already_completed", reviewId } };
  }

  const credentials = serviceAccount();
  if (!credentials) {
    return { status: 503, body: { error: "billing_not_configured" } };
  }

  const now = Date.now();
  const claim = await tx(async (client) => {
    const locked = await client.query<PendingRefundReviewRow>(
      "SELECT * FROM play_pending_refund_reviews WHERE review_id = $1 FOR UPDATE",
      [reviewId],
    );
    const row = locked.rows[0];
    if (!row) return { kind: "missing" as const };
    if (row.status === "COMPLETED") {
      return sameReviewSubmission(row, refundPreference, sampleContentProvided, consumptionPercentageMilliunits, evidence)
        ? { kind: "duplicate" as const, row }
        : { kind: "completed" as const, row };
    }
    if (row.status === "SUBMITTING") return { kind: "in_progress" as const, row };

    await client.query(
      `UPDATE play_pending_refund_reviews
       SET status = 'SUBMITTING',
           decision = $2,
           sample_content_provided = $3,
           consumption_percentage_milliunits = $4,
           consumption_usage_events = $5::jsonb,
           submit_attempts = submit_attempts + 1,
           last_attempt_at = $6,
           updated_at = $6
       WHERE review_id = $1`,
      [
        reviewId,
        refundPreference,
        sampleContentProvided,
        consumptionPercentageMilliunits,
        JSON.stringify(evidence),
        now,
      ],
    );
    return { kind: "claimed" as const, row };
  });

  if (claim.kind === "missing") return { status: 404, body: { error: "review_not_found" } };
  if (claim.kind === "duplicate") {
    return {
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        reviewId,
        decision: claim.row.decision,
        completedAt: claim.row.completed_at === null ? null : Number(claim.row.completed_at),
      },
    };
  }
  if (claim.kind === "completed") return { status: 409, body: { error: "review_already_completed", reviewId } };
  if (claim.kind === "in_progress") return { status: 409, body: { error: "review_submission_in_progress", reviewId } };

  const requestPayload: Record<string, unknown> = {
    pendingRefundToken: claim.row.pending_refund_token,
    sampleContentProvided,
    refundPreference,
  };
  if (consumptionPercentageMilliunits !== null) {
    requestPayload.consumptionPercentageMilliunits = consumptionPercentageMilliunits;
  }
  if (evidence.length > 0) requestPayload.consumptionUsageEvents = evidence;

  let providerStatus: number | null = null;
  let providerBody: unknown = {};
  try {
    const accessToken = await googleAccessToken(credentials);
    const endpoint = new URL(
      `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/orders/${encodeURIComponent(claim.row.order_id)}:reviewrefund`,
    );
    const providerResponse = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestPayload),
    });
    providerStatus = providerResponse.status;
    const text = await providerResponse.text();
    providerBody = safeProviderResponse(text);

    if (!providerResponse.ok) {
      await markRefundReviewFailed(reviewId, providerStatus, providerBody);
      return {
        status: 502,
        body: {
          error: "google_review_refund_failed",
          reviewId,
          providerStatus,
        },
      };
    }
  } catch (error) {
    providerBody = { error: "provider_request_failed", message: String((error as Error)?.message ?? "unknown").slice(0, 300) };
    await markRefundReviewFailed(reviewId, providerStatus, providerBody);
    return {
      status: 502,
      body: {
        error: "google_review_refund_failed",
        reviewId,
        providerStatus,
      },
    };
  }

  const completedAt = Date.now();
  await pool.query(
    `UPDATE play_pending_refund_reviews
     SET status = 'COMPLETED',
         google_status = $2,
         google_response = $3::jsonb,
         completed_at = $4,
         updated_at = $4
     WHERE review_id = $1`,
    [reviewId, providerStatus, JSON.stringify(providerBody), completedAt],
  );

  return {
    status: 200,
    body: {
      ok: true,
      duplicate: false,
      reviewId,
      decision: refundPreference,
      completedAt,
    },
  };
}

async function markRefundReviewFailed(reviewId: string, providerStatus: number | null, providerBody: unknown): Promise<void> {
  const now = Date.now();
  await pool.query(
    `UPDATE play_pending_refund_reviews
     SET status = 'FAILED',
         google_status = $2,
         google_response = $3::jsonb,
         updated_at = $4
     WHERE review_id = $1 AND status = 'SUBMITTING'`,
    [reviewId, providerStatus, JSON.stringify(providerBody), now],
  );
}

function sameReviewSubmission(
  row: PendingRefundReviewRow,
  preference: RefundPreference,
  sampleContentProvided: boolean,
  consumptionPercentageMilliunits: number | null,
  usageEvents: ConsumptionUsageEvent[],
): boolean {
  return row.decision === preference &&
    row.sample_content_provided === sampleContentProvided &&
    row.consumption_percentage_milliunits === consumptionPercentageMilliunits &&
    JSON.stringify(Array.isArray(row.consumption_usage_events) ? row.consumption_usage_events : []) === JSON.stringify(usageEvents);
}

function normalizeRefundPreference(value: unknown): RefundPreference | null {
  return value === "APPROVE" || value === "DECLINE" || value === "NEUTRAL" ? value : null;
}

function normalizeConsumptionUsageEvents(value: unknown): ConsumptionUsageEvent[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 1000) return null;

  const normalized: ConsumptionUsageEvent[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const event: ConsumptionUsageEvent = {};
    const obfuscatedAccountId = boundedOptionalString(record.obfuscatedAccountId, 256);
    const obfuscatedProfileId = boundedOptionalString(record.obfuscatedProfileId, 256);
    const consumptionTime = boundedOptionalString(record.consumptionTime, 64);
    const ipAddress = boundedOptionalString(record.ipAddress, 64);
    const description = boundedOptionalString(record.consumptionItemDescription, 5000);
    if (record.obfuscatedAccountId !== undefined && obfuscatedAccountId === null) return null;
    if (record.obfuscatedProfileId !== undefined && obfuscatedProfileId === null) return null;
    if (record.consumptionTime !== undefined && consumptionTime === null) return null;
    if (record.ipAddress !== undefined && ipAddress === null) return null;
    if (record.consumptionItemDescription !== undefined && description === null) return null;
    if (obfuscatedAccountId) event.obfuscatedAccountId = obfuscatedAccountId;
    if (obfuscatedProfileId) event.obfuscatedProfileId = obfuscatedProfileId;
    if (consumptionTime) event.consumptionTime = consumptionTime;
    if (ipAddress) event.ipAddress = ipAddress;
    if (description) event.consumptionItemDescription = description;

    if (record.location !== undefined) {
      if (!record.location || typeof record.location !== "object" || Array.isArray(record.location)) return null;
      const location = record.location as Record<string, unknown>;
      const regionCode = boundedOptionalString(location.regionCode, 8);
      if (!regionCode) return null;
      event.location = { regionCode };
      const administrativeArea = boundedOptionalString(location.administrativeArea, 128);
      const locality = boundedOptionalString(location.locality, 128);
      const sublocality = boundedOptionalString(location.sublocality, 128);
      if (location.administrativeArea !== undefined && administrativeArea === null) return null;
      if (location.locality !== undefined && locality === null) return null;
      if (location.sublocality !== undefined && sublocality === null) return null;
      if (administrativeArea) event.location.administrativeArea = administrativeArea;
      if (locality) event.location.locality = locality;
      if (sublocality) event.location.sublocality = sublocality;
    }
    normalized.push(event);
  }
  return normalized;
}

function boundedOptionalString(value: unknown, maxLength: number): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maxLength ? trimmed : null;
}

function safeProviderResponse(text: string): unknown {
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null ? parsed : { value: String(parsed).slice(0, 2000) };
  } catch {
    return { body: text.slice(0, 2000) };
  }
}

async function verifyGooglePushToken(
  token: string,
  expectedAudience: string,
  expectedEmail: string,
): Promise<GoogleTokenInfo | null> {
  const response = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(token)}`,
    { headers: { Accept: "application/json" } },
  ).catch(() => null);
  if (!response?.ok) return null;

  let claims: GoogleTokenInfo;
  try {
    claims = await response.json() as GoogleTokenInfo;
  } catch {
    return null;
  }

  const expiresAt = Number.parseInt(claims.exp ?? "", 10) * 1000;
  const issuerOk = claims.iss === "https://accounts.google.com" || claims.iss === "accounts.google.com";
  return claims.aud === expectedAudience &&
      claims.email?.toLowerCase() === expectedEmail &&
      claims.email_verified === "true" &&
      issuerOk &&
      Number.isFinite(expiresAt) &&
      expiresAt > Date.now()
    ? claims
    : null;
}

export function googlePlayHealthStatus(): "configured" | "not_configured" {
  return serviceAccount() ? "configured" : "not_configured";
}

async function verifyAndGrant(request: http.IncomingMessage, user: CommerceUser): Promise<ApiResult> {
  const body = await readJson(request);
  const productId = typeof body.productId === "string" ? body.productId.trim() : "";
  const purchaseToken = typeof body.purchaseToken === "string" ? body.purchaseToken.trim() : "";
  if (!productId || !purchaseToken || purchaseToken.length > 4096) {
    return { status: 400, body: { error: "validation_failed", message: "Missing Google Play product or purchase token." } };
  }

  const productResult = await pool.query<PaidProduct>(
    `SELECT product_id, currency, amount
     FROM paid_currency_products
     WHERE product_id = $1 AND active = true`,
    [productId],
  );
  const product = productResult.rows[0];
  if (!product) return { status: 404, body: { error: "unknown_product", message: "That currency pack is not active." } };

  const tokenDigest = sha256(purchaseToken);
  const existing = await purchaseReceiptIdentity(pool, tokenDigest);
  if (existing) {
    const duplicate = duplicateReceiptResult(existing, user.user_id, productId);
    if (duplicate) return duplicate;
    const fresh = await getCommerceUser(pool, user.user_id);
    const finalized = await consumeWithGooglePlay(existing.product_id, purchaseToken);
    return {
      status: 200,
      body: {
        ok: true,
        duplicate: true,
        productId: existing.product_id,
        balances: normalizeBalances(fresh?.currency_balances),
        playFinalized: finalized,
      },
    };
  }

  const play = await verifyWithGooglePlay(productId, purchaseToken, accountBinding(user.user_id));
  if (!play.ok) return play.result;
  const quantity = clampPositive(play.purchase.quantity ?? 1, 1, 10);
  const grantedAmount = Number(product.amount) * quantity;

  const grant = await tx<GrantSuccess | GrantFailure>(async (client) => {
    const seen = await purchaseReceiptIdentity(client, tokenDigest);
    if (seen) {
      const duplicate = duplicateReceiptFailure(seen, user.user_id, productId);
      if (duplicate) return duplicate;
      const fresh = await getCommerceUser(client, user.user_id);
      return {
        ok: true,
        duplicate: true,
        productId: seen.product_id,
        balances: normalizeBalances(fresh?.currency_balances),
      };
    }

    // Serialize grants for one Quiz Royale account. A second verification for
    // the same Play token that entered before the first receipt committed waits
    // here, then re-checks the receipt before touching any currency balance.
    const locked = await getCommerceUser(client, user.user_id, true);
    if (!locked) return { ok: false, status: 404, body: { error: "user_not_found" } };

    const committedWhileWaiting = await purchaseReceiptIdentity(client, tokenDigest);
    if (committedWhileWaiting) {
      const duplicate = duplicateReceiptFailure(committedWhileWaiting, user.user_id, productId);
      if (duplicate) return duplicate;
      return {
        ok: true,
        duplicate: true,
        productId: committedWhileWaiting.product_id,
        balances: normalizeBalances(locked.currency_balances),
      };
    }

    const balances = normalizeBalances(locked.currency_balances);
    const next = { ...balances, [product.currency]: balances[product.currency] + grantedAmount };
    await client.query("UPDATE users SET currency_balances = $2 WHERE user_id = $1", [user.user_id, JSON.stringify(next)]);

    const now = Date.now();
    await client.query(
      `INSERT INTO play_purchase_receipts(
        token_digest, user_id, product_id, order_id, quantity, currency,
        amount_per_unit, granted_amount, purchase_time, verified_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        tokenDigest,
        user.user_id,
        product.product_id,
        play.purchase.orderId ?? null,
        quantity,
        product.currency,
        Number(product.amount),
        grantedAmount,
        parseMillis(play.purchase.purchaseTimeMillis),
        now,
      ],
    );
    await client.query(
      `INSERT INTO currency_ledger(
        ledger_id, user_id, currency, delta, balance_after, reason, reference_id, created_at
      ) VALUES ($1,$2,$3,$4,$5,'google_play_purchase',$6,$7)
      ON CONFLICT DO NOTHING`,
      [`cl-play-${tokenDigest.slice(0, 40)}`, user.user_id, product.currency, grantedAmount, next[product.currency], tokenDigest, now],
    );

    return {
      ok: true,
      duplicate: false,
      productId,
      currency: product.currency,
      grantedAmount,
      balances: next,
    };
  });

  if (!grant.ok) return { status: grant.status, body: grant.body };

  // Entitlement is committed before Play consumption. If Play is temporarily
  // unreachable, the receipt remains idempotent and a later retry will only
  // re-attempt finalization; it can never double-credit currency.
  const finalized = await consumeWithGooglePlay(grant.productId, purchaseToken);
  return {
    status: 200,
    body: { ...grant, playFinalized: finalized },
  };
}

async function verifyWithGooglePlay(
  productId: string,
  purchaseToken: string,
  expectedAccountBinding: string,
): Promise<{ ok: true; purchase: GoogleProductPurchase } | { ok: false; result: ApiResult }> {
  const credentials = serviceAccount();
  if (!credentials) {
    return {
      ok: false,
      result: { status: 503, body: { error: "billing_not_configured", message: "Google Play verification is not configured on the server." } },
    };
  }
  const accessToken = await googleAccessToken(credentials);
  const endpoint = playPurchaseEndpoint(productId, purchaseToken);
  const response = await fetch(endpoint, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await response.text();
  let purchase: GoogleProductPurchase = {};
  try { purchase = text ? JSON.parse(text) as GoogleProductPurchase : {}; } catch { /* handled below */ }
  if (!response.ok) {
    console.warn("Google Play verification rejected", response.status, text.slice(0, 300));
    return { ok: false, result: { status: 409, body: { error: "play_verification_failed", message: "Google Play could not verify that purchase." } } };
  }
  if (purchase.purchaseState !== 0) {
    return { ok: false, result: { status: 409, body: { error: "purchase_not_completed", message: "The Google Play purchase is not completed yet." } } };
  }
  if (purchase.consumptionState === 1) {
    return { ok: false, result: { status: 409, body: { error: "purchase_already_consumed", message: "That purchase was already consumed before it was granted." } } };
  }
  if (purchase.productId && purchase.productId !== productId) {
    return { ok: false, result: { status: 409, body: { error: "product_mismatch" } } };
  }
  if (purchase.obfuscatedExternalAccountId !== expectedAccountBinding) {
    return {
      ok: false,
      result: {
        status: 409,
        body: { error: "account_mismatch", message: "That Google Play purchase is not attributed to this Quiz Royale account." },
      },
    };
  }
  return { ok: true, purchase };
}

async function consumeWithGooglePlay(productId: string, purchaseToken: string): Promise<boolean> {
  const credentials = serviceAccount();
  if (!credentials) return false;
  try {
    const accessToken = await googleAccessToken(credentials);
    const response = await fetch(`${playPurchaseEndpoint(productId, purchaseToken)}:consume`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (response.ok) return true;
    const text = await response.text();
    if (isAlreadyFinalizedGooglePlayConsumeResponse(response.status, text)) return true;
    console.warn("Google Play consume failed", response.status);
    return false;
  } catch (error) {
    console.warn("Google Play consume unavailable", (error as Error)?.message);
    return false;
  }
}

function isAlreadyFinalizedGooglePlayConsumeResponse(status: number, text: string): boolean {
  if (status !== 400) return false;
  try {
    const payload: unknown = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
    const error = (payload as { error?: unknown }).error;
    if (!error || typeof error !== "object" || Array.isArray(error)) return false;
    const structured = error as { errors?: unknown };
    if (!Array.isArray(structured.errors)) return false;
    return structured.errors.some((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
      const detail = entry as { reason?: unknown };
      return detail.reason === "productNotOwnedByUser";
    });
  } catch {
    return false;
  }
}

function playPurchaseEndpoint(productId: string, purchaseToken: string): string {
  return `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(PACKAGE_NAME)}/purchases/products/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`;
}

async function authenticate(request: http.IncomingMessage): Promise<CommerceUser | null> {
  const raw = headerValue(request, "authorization");
  if (!raw?.startsWith("Bearer ")) return null;
  const token = raw.slice(7).trim();
  if (!token) return null;
  const result = await pool.query<CommerceUser>(
    `SELECT u.user_id, u.currency_balances
     FROM sessions s
     JOIN users u ON u.user_id = s.user_id
     WHERE s.token_digest = $1 AND s.expires_at > $2`,
    [sha256(token), Date.now()],
  );
  return result.rows[0] ?? null;
}

async function getCommerceUser(db: DbClient, userId: string, forUpdate = false): Promise<CommerceUser | null> {
  const result = await db.query<CommerceUser>(
    `SELECT user_id, currency_balances FROM users WHERE user_id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function purchaseReceiptIdentity(db: DbClient, tokenDigest: string): Promise<PurchaseReceiptIdentity | null> {
  const result = await db.query<PurchaseReceiptIdentity>(
    "SELECT user_id, product_id FROM play_purchase_receipts WHERE token_digest = $1",
    [tokenDigest],
  );
  return result.rows[0] ?? null;
}

function duplicateReceiptResult(
  receipt: PurchaseReceiptIdentity,
  userId: string,
  requestedProductId: string,
): ApiResult | null {
  if (receipt.user_id !== userId) {
    return { status: 409, body: { error: "purchase_already_claimed", message: "That Play purchase belongs to another account." } };
  }
  if (receipt.product_id !== requestedProductId) {
    return { status: 409, body: { error: "product_mismatch", message: "That Play purchase was verified for a different product." } };
  }
  return null;
}

function duplicateReceiptFailure(
  receipt: PurchaseReceiptIdentity,
  userId: string,
  requestedProductId: string,
): GrantFailure | null {
  const result = duplicateReceiptResult(receipt, userId, requestedProductId);
  return result ? { ok: false, status: result.status, body: result.body } : null;
}

function normalizeBalances(raw: unknown): Balances {
  const value = typeof raw === "object" && raw !== null ? raw as Partial<Balances> : {};
  return {
    coins: safeBalance(value.coins),
    gems: safeBalance(value.gems),
    seasonalTickets: safeBalance(value.seasonalTickets),
  };
}

function safeBalance(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 0;
}

function accountBinding(userId: string): string {
  // 64-char, non-PII stable identifier accepted by BillingFlowParams.
  return sha256(`quizroyale:${userId}`);
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  const encoded = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();

  // Prefer Base64 on Railway so JSON quoting/newlines cannot corrupt the
  // credential. If one configured source is malformed, try the other instead
  // of allowing a stale variable to mask a valid one.
  if (encoded) {
    try {
      const normalized = encoded.replace(/\s+/g, "");
      const decoded = Buffer.from(normalized, "base64").toString("utf8");
      const parsed = parseServiceAccountSource(decoded);
      if (parsed) return parsed;
      console.warn("Google Play service account Base64 decoded but lacked required fields", {
        encodedLength: encoded.length,
        decodedLength: decoded.length,
      });
    } catch (error) {
      console.warn("Google Play service account Base64 could not be decoded", {
        encodedLength: encoded.length,
        error: (error as Error)?.message,
      });
    }
  }

  if (raw) {
    const parsed = parseServiceAccountSource(raw);
    if (parsed) return parsed;
    console.warn("Google Play service account JSON lacked required fields", {
      rawLength: raw.length,
    });
  }

  console.warn("Google Play service account is unavailable", {
    base64Present: Boolean(encoded),
    base64Length: encoded?.length ?? 0,
    rawPresent: Boolean(raw),
    rawLength: raw?.length ?? 0,
  });
  return null;
}

function parseServiceAccountSource(source: string): ServiceAccount | null {
  try {
    // Some downloaded JSON files include a UTF-8 BOM. Node's JSON.parse does
    // not accept it, so strip it before parsing.
    const cleaned = source.replace(/^\uFEFF/, "").trim();
    const parsed = JSON.parse(cleaned) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      token_uri: parsed.token_uri,
    };
  } catch (error) {
    console.warn("Google Play service account JSON could not be parsed", {
      sourceLength: source.length,
      error: (error as Error)?.message,
    });
    return null;
  }
}

function billingStatus(): Record<string, unknown> {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  const encoded = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();

  let base64DecodedLength = 0;
  let base64JsonValid = false;
  let base64HasClientEmail = false;
  let base64HasPrivateKey = false;
  let base64ProjectId: string | null = null;
  let base64Type: string | null = null;

  if (encoded) {
    try {
      const normalized = encoded.replace(/\s+/g, "");
      const decoded = Buffer.from(normalized, "base64").toString("utf8");
      base64DecodedLength = decoded.length;
      const parsed = JSON.parse(decoded.replace(/^\uFEFF/, "").trim()) as Record<string, unknown>;
      base64JsonValid = true;
      base64HasClientEmail = typeof parsed.client_email === "string" && parsed.client_email.length > 0;
      base64HasPrivateKey = typeof parsed.private_key === "string" && parsed.private_key.length > 0;
      base64ProjectId = typeof parsed.project_id === "string" ? parsed.project_id : null;
      base64Type = typeof parsed.type === "string" ? parsed.type : null;
    } catch {
      // Safe diagnostics only; never expose credential contents.
    }
  }

  return {
    service: "quiz-royale-api",
    billingProvider: "google_play",
    packageName: PACKAGE_NAME,
    configured: Boolean(serviceAccount()),
    credentialEnv: {
      base64Present: Boolean(encoded),
      base64Length: encoded?.length ?? 0,
      rawJsonPresent: Boolean(raw),
      rawJsonLength: raw?.length ?? 0,
    },
    base64Inspection: {
      decodedLength: base64DecodedLength,
      jsonValid: base64JsonValid,
      hasClientEmail: base64HasClientEmail,
      hasPrivateKey: base64HasPrivateKey,
      projectId: base64ProjectId,
      type: base64Type,
    },
    deployCommit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    railwayRuntime: {
      serviceId: process.env.RAILWAY_SERVICE_ID ?? null,
      serviceName: process.env.RAILWAY_SERVICE_NAME ?? null,
      environmentId: process.env.RAILWAY_ENVIRONMENT_ID ?? null,
      environmentName: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
    },
  };
}

async function googleAccessToken(credentials: ServiceAccount): Promise<string> {
  if (accessTokenCache && accessTokenCache.expiresAt > Date.now() + 60_000) return accessTokenCache.token;
  const now = Math.floor(Date.now() / 1000);
  const audience = credentials.token_uri || "https://oauth2.googleapis.com/token";
  const header = base64UrlJson({ alg: "RS256", typ: "JWT" });
  const claims = base64UrlJson({
    iss: credentials.client_email,
    scope: PLAY_SCOPE,
    aud: audience,
    iat: now,
    exp: now + 3600,
  });
  const unsigned = `${header}.${claims}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(credentials.private_key).toString("base64url")}`;
  const tokenResponse = await fetch(audience, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth-grant-type:jwt-bearer",
      assertion,
    }),
  });
  const payload = await tokenResponse.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!tokenResponse.ok || !payload.access_token) throw new Error(`Google OAuth failed: ${payload.error ?? tokenResponse.status}`);
  accessTokenCache = {
    token: payload.access_token,
    expiresAt: Date.now() + Math.max(60, payload.expires_in ?? 3600) * 1000,
  };
  return payload.access_token;
}

async function readJson(request: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY) throw Object.assign(new Error("payload too large"), { statusCode: 413 });
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function isAllowedOrigin(origin: string): boolean {
  if (DEFAULT_ORIGINS.has(origin)) return true;
  const configured = [process.env.CORS_ORIGIN, process.env.CORS_ORIGINS]
    .filter((value): value is string => Boolean(value?.trim()))
    .flatMap((value) => value.split(","))
    .map((value) => value.trim().replace(/\/$/, ""));
  if (configured.includes(origin)) return true;
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.hostname.endsWith(`.${PAGES_HOST}`);
  } catch {
    return false;
  }
}

function authorizedInternal(request: http.IncomingMessage): boolean {
  const expected = process.env.INTERNAL_API_TOKEN?.trim();
  const provided = headerValue(request, "x-internal-token")?.trim();
  if (!expected || !provided) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function optionalInt(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function optionalPositiveInt(value: unknown): number | null {
  const parsed = optionalInt(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function headerValue(request: http.IncomingMessage, name: string): string | null {
  const value = request.headers[name];
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function parseMillis(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function clampPositive(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function send(response: http.ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function finish(response: http.ServerResponse, result: ApiResult): true {
  send(response, result.status, result.body);
  return true;
}
