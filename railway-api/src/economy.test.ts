import assert from "node:assert/strict";
import test from "node:test";

type EconomyModule = {
  matchEconomyReward(score: number, correctAnswers: number, won: boolean): { coins: number; gems: number };
  seasonXpGain(score: number, correctAnswers: number, won: boolean): number;
  parseEconomyReportWindow(raw: string | null, now?: number): { from: number; to: number; windowMs: number } | null;
  summarizeEconomyLedger(rows: Array<{ currency: string; delta: number; reason: string; eventCount?: number }>): {
    currencies: Record<string, { faucet: number; sink: number; reversal: number; net: number; events: number }>;
    reasons: Record<string, { delta: number; events: number }>;
  };
};

const economyModulePath = "./economy.js";

async function loadEconomy(): Promise<EconomyModule> {
  const module = await import(economyModulePath).catch(() => null);
  assert.ok(module, "economy analysis module should exist");
  return module as unknown as EconomyModule;
}

test("match economy reward preserves the current competitive reward curve", async () => {
  const economy = await loadEconomy();
  assert.deepEqual(economy.matchEconomyReward(0, 0, false), { coins: 10, gems: 0 });
  assert.deepEqual(economy.matchEconomyReward(400, 4, true), { coins: 115, gems: 1 });
});

test("season XP gain preserves the current progression curve", async () => {
  const economy = await loadEconomy();
  assert.equal(economy.seasonXpGain(0, 0, false), 25);
  assert.equal(economy.seasonXpGain(400, 4, true), 180);
});

test("economy report windows are bounded and reject invalid values", async () => {
  const economy = await loadEconomy();
  const now = 2_000_000_000_000;
  assert.deepEqual(economy.parseEconomyReportWindow(null, now), {
    from: now - 24 * 60 * 60 * 1000,
    to: now,
    windowMs: 24 * 60 * 60 * 1000,
  });
  assert.deepEqual(economy.parseEconomyReportWindow("3600000", now), {
    from: now - 3_600_000,
    to: now,
    windowMs: 3_600_000,
  });
  assert.equal(economy.parseEconomyReportWindow("1", now), null);
  assert.equal(economy.parseEconomyReportWindow(String(31 * 24 * 60 * 60 * 1000), now), null);
  assert.equal(economy.parseEconomyReportWindow("nope", now), null);
});

test("ledger summary separates faucets, player sinks, and refund reversals", async () => {
  const economy = await loadEconomy();
  const summary = economy.summarizeEconomyLedger([
    { currency: "coins", delta: 100, reason: "match_reward", eventCount: 2 },
    { currency: "coins", delta: -30, reason: "store_purchase", eventCount: 1 },
    { currency: "gems", delta: 5, reason: "season_reward", eventCount: 1 },
    { currency: "gems", delta: -2, reason: "google_play_void", eventCount: 1 },
    { currency: "seasonalTickets", delta: 3, reason: "season_level", eventCount: 3 },
  ]);

  assert.deepEqual(summary.currencies.coins, { faucet: 100, sink: 30, reversal: 0, net: 70, events: 3 });
  assert.deepEqual(summary.currencies.gems, { faucet: 5, sink: 0, reversal: 2, net: 3, events: 2 });
  assert.deepEqual(summary.currencies.seasonalTickets, { faucet: 3, sink: 0, reversal: 0, net: 3, events: 3 });
  assert.deepEqual(summary.reasons.google_play_void, { delta: -2, events: 1 });
  assert.deepEqual(summary.reasons.match_reward, { delta: 100, events: 2 });
});
