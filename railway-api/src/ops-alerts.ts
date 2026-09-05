export type OperationalFailureCategory = "api" | "matchmaking" | "database" | "commerce";

export type OperationalAlert = {
  service: string;
  category: OperationalFailureCategory;
  count: number;
  windowMs: number;
  occurredAt: number;
  summary: string;
};

type DeliverAlert = (alert: OperationalAlert) => Promise<void>;

export class OperationalFailureTracker {
  private readonly failures = new Map<OperationalFailureCategory, number[]>();
  private readonly lastDeliveredAt = new Map<OperationalFailureCategory, number>();

  constructor(
    private readonly deliver: DeliverAlert,
    private readonly threshold = 5,
    private readonly windowMs = 60_000,
    private readonly cooldownMs = 5 * 60_000,
  ) {}

  async record(
    category: OperationalFailureCategory,
    summary: string,
    now = Date.now(),
  ): Promise<boolean> {
    const cutoff = now - this.windowMs;
    const recent = (this.failures.get(category) ?? []).filter((value) => value > cutoff);
    recent.push(now);
    this.failures.set(category, recent);

    if (recent.length < this.threshold) return false;
    const lastDelivered = this.lastDeliveredAt.get(category) ?? 0;
    if (lastDelivered > 0 && now - lastDelivered < this.cooldownMs) return false;

    this.lastDeliveredAt.set(category, now);
    await this.deliver({
      service: process.env.RAILWAY_SERVICE_NAME?.trim() || "quiz-royale-api",
      category,
      count: recent.length,
      windowMs: this.windowMs,
      occurredAt: now,
      summary: safeSummary(summary),
    });
    return true;
  }
}

function safeSummary(value: string): string {
  return value.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300) || "operational failure";
}

function configuredPositiveInt(name: string, fallback: number): number {
  const raw = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

export function buildOperationalAlertWebhookPayload(alert: OperationalAlert): Record<string, unknown> {
  const text = `[${alert.category}] ${alert.summary}`.replace(/[\r\n]+/g, " ").trim().slice(0, 300);

  return {
    text,
    event: "quiz_royale_operational_alert",
    ...alert,
    deployCommit: process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ?? null,
    environment: process.env.RAILWAY_ENVIRONMENT_NAME ?? null,
  };
}

async function deliverWebhook(alert: OperationalAlert): Promise<void> {
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

const defaultTracker = new OperationalFailureTracker(
  deliverWebhook,
  configuredPositiveInt("OPS_ALERT_FAILURE_THRESHOLD", 5),
  configuredPositiveInt("OPS_ALERT_WINDOW_MS", 60_000),
  configuredPositiveInt("OPS_ALERT_COOLDOWN_MS", 5 * 60_000),
);

export async function recordOperationalFailure(
  category: OperationalFailureCategory,
  summary: string,
): Promise<void> {
  await defaultTracker.record(category, summary).catch((error) => {
    console.warn("Operational failure tracking failed", (error as Error)?.message);
  });
}
