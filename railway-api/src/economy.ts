export const DEFAULT_ECONOMY_REPORT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MIN_ECONOMY_REPORT_WINDOW_MS = 5 * 60 * 1000;
export const MAX_ECONOMY_REPORT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

const ECONOMY_CURRENCIES = ["coins", "gems", "seasonalTickets"] as const;
type EconomyCurrency = typeof ECONOMY_CURRENCIES[number];

type LedgerRow = {
  currency: string;
  delta: number;
  reason: string;
  eventCount?: number;
};

type CurrencySummary = {
  faucet: number;
  sink: number;
  reversal: number;
  net: number;
  events: number;
};

type ReasonSummary = {
  delta: number;
  events: number;
};

export function matchEconomyReward(
  score: number,
  correctAnswers: number,
  won: boolean,
): { coins: number; gems: number } {
  const coins = Math.max(10, Math.floor(score / 20) + correctAnswers * 5 + (won ? 75 : 0));
  return { coins, gems: won ? 1 : 0 };
}

export function seasonXpGain(score: number, correctAnswers: number, won: boolean): number {
  return Math.max(25, Math.floor(score / 10) + correctAnswers * 10 + (won ? 100 : 0));
}

export function parseEconomyReportWindow(
  raw: string | null,
  now = Date.now(),
): { from: number; to: number; windowMs: number } | null {
  const windowMs = raw === null || raw.trim() === ""
    ? DEFAULT_ECONOMY_REPORT_WINDOW_MS
    : Number(raw);
  if (!Number.isInteger(windowMs)) return null;
  if (windowMs < MIN_ECONOMY_REPORT_WINDOW_MS || windowMs > MAX_ECONOMY_REPORT_WINDOW_MS) return null;
  return { from: now - windowMs, to: now, windowMs };
}

export function summarizeEconomyLedger(rows: LedgerRow[]): {
  currencies: Record<EconomyCurrency, CurrencySummary>;
  reasons: Record<string, ReasonSummary>;
} {
  const currencies = Object.fromEntries(
    ECONOMY_CURRENCIES.map((currency) => [currency, emptyCurrencySummary()]),
  ) as Record<EconomyCurrency, CurrencySummary>;
  const reasons: Record<string, ReasonSummary> = {};

  for (const row of rows) {
    if (!isEconomyCurrency(row.currency)) continue;
    if (!Number.isFinite(row.delta)) continue;
    const events = positiveCount(row.eventCount);
    const currency = currencies[row.currency];
    currency.net += row.delta;
    currency.events += events;

    if (row.delta > 0) {
      currency.faucet += row.delta;
    } else if (row.delta < 0 && row.reason === "google_play_void") {
      currency.reversal += Math.abs(row.delta);
    } else if (row.delta < 0) {
      currency.sink += Math.abs(row.delta);
    }

    const reason = reasons[row.reason] ?? { delta: 0, events: 0 };
    reason.delta += row.delta;
    reason.events += events;
    reasons[row.reason] = reason;
  }

  return { currencies, reasons };
}

function emptyCurrencySummary(): CurrencySummary {
  return { faucet: 0, sink: 0, reversal: 0, net: 0, events: 0 };
}

function isEconomyCurrency(value: string): value is EconomyCurrency {
  return (ECONOMY_CURRENCIES as readonly string[]).includes(value);
}

function positiveCount(value: number | undefined): number {
  return Number.isFinite(value) && Number(value) > 0 ? Math.floor(Number(value)) : 1;
}
