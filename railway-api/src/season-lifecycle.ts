import { tx } from "./db.js";

const DEFAULT_SEASON_RECONCILE_INTERVAL_MS = 15 * 60 * 1000;

export type SeasonLifecycleState = {
  activeSeasonId: string | null;
  changed: boolean;
};

/**
 * Reconciles the legacy `active` flag with calendar time. Reads throughout the
 * API also use the season time window directly, so a scheduler delay can never
 * keep an expired season logically active.
 */
export async function reconcileSeasonLifecycle(now = Date.now()): Promise<SeasonLifecycleState> {
  return await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('quiz-royale-season-lifecycle')::bigint)");

    const before = await client.query<{ season_id: string }>(
      "SELECT season_id FROM seasons WHERE active = true LIMIT 1",
    );
    const current = await client.query<{ season_id: string }>(
      `SELECT season_id
       FROM seasons
       WHERE starts_at <= $1 AND ends_at > $1
       ORDER BY starts_at DESC, created_at DESC, season_id
       LIMIT 1`,
      [now],
    );
    const activeSeasonId = current.rows[0]?.season_id ?? null;
    const previousSeasonId = before.rows[0]?.season_id ?? null;

    await client.query("UPDATE seasons SET active = false WHERE active = true");
    if (activeSeasonId) {
      await client.query("UPDATE seasons SET active = true WHERE season_id = $1", [activeSeasonId]);
    }

    return {
      activeSeasonId,
      changed: previousSeasonId !== activeSeasonId,
    };
  });
}

export function startSeasonLifecycleReconciler(): () => void {
  if (process.env.NODE_ENV === "test" || process.env.SEASON_LIFECYCLE_RECONCILIATION === "false") {
    return () => undefined;
  }

  const configured = Number.parseInt(process.env.SEASON_LIFECYCLE_RECONCILE_INTERVAL_MS ?? "", 10);
  const intervalMs = Number.isFinite(configured) && configured >= 60_000
    ? configured
    : DEFAULT_SEASON_RECONCILE_INTERVAL_MS;

  let stopped = false;
  let interval: ReturnType<typeof setInterval> | null = null;

  const run = async () => {
    if (stopped) return;
    try {
      const result = await reconcileSeasonLifecycle();
      if (result.changed) {
        console.log("season lifecycle changed", result.activeSeasonId ?? "no-active-season");
      }
    } catch (error) {
      console.error("season lifecycle reconciliation failed", (error as Error)?.message);
    }
  };

  const initial = setTimeout(() => {
    void run();
    interval = setInterval(() => void run(), intervalMs);
  }, 5_000);

  return () => {
    stopped = true;
    clearTimeout(initial);
    if (interval) clearInterval(interval);
  };
}
