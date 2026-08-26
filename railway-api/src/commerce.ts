import http from "node:http";
import { createHash, createSign } from "node:crypto";
import { URL } from "node:url";
import { pool, tx, type DbClient } from "./db.js";

type CurrencyKind = "coins" | "gems";
type Balances = { coins: number; gems: number; seasonalTickets: number };
type PaidProduct = { product_id: string; currency: CurrencyKind; amount: number };
type PurchaseReceiptIdentity = { user_id: string; product_id: string };
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

let accessTokenCache: { token: string; expiresAt: number } | null = null;

export async function handleCommerceRequest(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<boolean> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  const isCommerceRoute = url.pathname === "/store/currency-packs" || url.pathname === "/store/google-play/verify";
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
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return true;
  }

  try {
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
    console.warn("Google Play consume failed", response.status, text.slice(0, 300));
    return false;
  } catch (error) {
    console.warn("Google Play consume unavailable", (error as Error)?.message);
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
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function accountBinding(userId: string): string {
  // 64-char, non-PII stable identifier accepted by BillingFlowParams.
  return sha256(`quizroyale:${userId}`);
}

function serviceAccount(): ServiceAccount | null {
  const raw = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON?.trim();
  const encoded = process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  const source = raw || (encoded ? Buffer.from(encoded, "base64").toString("utf8") : "");
  if (!source) return null;
  try {
    const parsed = JSON.parse(source) as Partial<ServiceAccount>;
    if (!parsed.client_email || !parsed.private_key) return null;
    return {
      client_email: parsed.client_email,
      private_key: parsed.private_key.replace(/\\n/g, "\n"),
      token_uri: parsed.token_uri,
    };
  } catch {
    return null;
  }
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
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
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
