from pathlib import Path


def replace_once(path_name: str, old: str, new: str) -> None:
    path = Path(path_name)
    text = path.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path_name}: {count}")
    path.write_text(text.replace(old, new, 1))


ops = "railway-api/src/ops-alerts.ts"
replace_once(
    ops,
    'type DeliverAlert = (alert: OperationalAlert) => Promise<void>;\n',
    '''type DeliverAlert = (alert: OperationalAlert) => Promise<void>;

export type OperationalAlertDeliveryResult =
  | { ok: true; status: number }
  | {
      ok: false;
      error: "not_configured" | "invalid_url" | "https_required" | "network_error" | "rejected";
      status?: number;
    };
''',
)

old_delivery = '''async function deliverWebhook(alert: OperationalAlert): Promise<void> {
  const raw = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!raw) return;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.warn("Operational alert webhook URL is invalid");
    return;
  }
  if (url.protocol !== "https:") {
    console.warn("Operational alert webhook must use HTTPS");
    return;
  }

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildOperationalAlertWebhookPayload(alert)),
    signal: AbortSignal.timeout(5_000),
  }).catch((error) => {
    console.warn("Operational alert webhook delivery failed", (error as Error)?.message);
    return null;
  });

  if (response && !response.ok) {
    console.warn("Operational alert webhook rejected delivery", response.status);
  }
}
'''
new_delivery = '''async function deliverWebhookResult(alert: OperationalAlert): Promise<OperationalAlertDeliveryResult> {
  const raw = process.env.OPS_ALERT_WEBHOOK_URL?.trim();
  if (!raw) return { ok: false, error: "not_configured" };

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, error: "invalid_url" };
  }
  if (url.protocol !== "https:") return { ok: false, error: "https_required" };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildOperationalAlertWebhookPayload(alert)),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);

  if (!response) return { ok: false, error: "network_error" };
  if (!response.ok) return { ok: false, error: "rejected", status: response.status };
  return { ok: true, status: response.status };
}

async function deliverWebhook(alert: OperationalAlert): Promise<void> {
  const result = await deliverWebhookResult(alert);
  if (result.ok || result.error === "not_configured") return;
  if (result.error === "invalid_url") console.warn("Operational alert webhook URL is invalid");
  else if (result.error === "https_required") console.warn("Operational alert webhook must use HTTPS");
  else if (result.error === "network_error") console.warn("Operational alert webhook delivery failed");
  else console.warn("Operational alert webhook rejected delivery", result.status);
}

export async function sendOperationalTestAlert(now = Date.now()): Promise<OperationalAlertDeliveryResult> {
  return deliverWebhookResult({
    service: process.env.RAILWAY_SERVICE_NAME?.trim() || "quiz-royale-api",
    category: "api",
    count: 1,
    windowMs: 0,
    occurredAt: now,
    summary: "Quiz Royale operational alert delivery test",
  });
}
'''
replace_once(ops, old_delivery, new_delivery)

server = "railway-api/src/server.ts"
replace_once(
    server,
    'import { googlePlayHealthStatus } from "./commerce.js";\n',
    'import { googlePlayHealthStatus } from "./commerce.js";\nimport { sendOperationalTestAlert } from "./ops-alerts.js";\n',
)
replace_once(
    server,
    '    if (request.method === "GET" && url.pathname === "/internal/economy-report") return sendResponse(response, await internalEconomyReport(request, url));\n',
    '    if (request.method === "GET" && url.pathname === "/internal/economy-report") return sendResponse(response, await internalEconomyReport(request, url));\n    if (request.method === "POST" && url.pathname === "/internal/ops-alert-test") return sendResponse(response, await internalOpsAlertTest(request));\n',
)
replace_once(
    server,
    'async function internalEconomyReport(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {\n',
    '''async function internalOpsAlertTest(request: http.IncomingMessage): Promise<ApiResponse> {
  if (!authorizedInternal(request)) return [401, { error: "unauthorized" }];

  const result = await sendOperationalTestAlert();
  if (result.ok) return [200, { ok: true, delivered: true, status: result.status }];
  if (result.error === "not_configured") return [503, { error: "ops_alert_not_configured" }];
  return [502, {
    error: "ops_alert_delivery_failed",
    reason: result.error,
    status: result.status ?? null,
  }];
}

async function internalEconomyReport(request: http.IncomingMessage, url: URL): Promise<ApiResponse> {
''',
)

test_path = "railway-api/src/ops-alerts.test.ts"
replace_once(
    test_path,
    'import { OperationalFailureTracker, buildOperationalAlertWebhookPayload, type OperationalAlert } from "./ops-alerts.js";\n',
    'import { OperationalFailureTracker, buildOperationalAlertWebhookPayload, sendOperationalTestAlert, type OperationalAlert } from "./ops-alerts.js";\n',
)
path = Path(test_path)
text = path.read_text()
text += '''

test("sendOperationalTestAlert posts one bounded HTTPS certification payload", async () => {
  const previousWebhook = process.env.OPS_ALERT_WEBHOOK_URL;
  const previousFetch = globalThis.fetch;
  process.env.OPS_ALERT_WEBHOOK_URL = "https://alerts.example.test/hook";
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    const result = await sendOperationalTestAlert(1_700_000_000_000);
    assert.deepEqual(result, { ok: true, status: 204 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0]?.url, "https://alerts.example.test/hook");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.deepEqual(calls[0]?.init?.headers, { "Content-Type": "application/json" });
    const payload = JSON.parse(String(calls[0]?.init?.body)) as Record<string, unknown>;
    assert.equal(payload.event, "quiz_royale_operational_alert");
    assert.equal(payload.summary, "Quiz Royale operational alert delivery test");
    assert.equal(payload.category, "api");
    assert.equal(payload.count, 1);
    assert.equal(payload.occurredAt, 1_700_000_000_000);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWebhook === undefined) delete process.env.OPS_ALERT_WEBHOOK_URL;
    else process.env.OPS_ALERT_WEBHOOK_URL = previousWebhook;
  }
});

test("sendOperationalTestAlert reports missing configuration without network access", async () => {
  const previousWebhook = process.env.OPS_ALERT_WEBHOOK_URL;
  const previousFetch = globalThis.fetch;
  delete process.env.OPS_ALERT_WEBHOOK_URL;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    assert.deepEqual(await sendOperationalTestAlert(1), { ok: false, error: "not_configured" });
    assert.equal(called, false);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousWebhook === undefined) delete process.env.OPS_ALERT_WEBHOOK_URL;
    else process.env.OPS_ALERT_WEBHOOK_URL = previousWebhook;
  }
});
'''
path.write_text(text)
