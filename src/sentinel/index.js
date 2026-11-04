// SENTINEL — continuous re-clearance.
// tick() re-runs every agent whose sentinel_next_run_at has passed. It is driven by Maritime's
// schedule (GET /schedules → POST /sentinel/tick) in production, and by an in-process timer in
// local dev (LOXE_INTERNAL_SCHEDULER=1, default outside production). Deploy webhooks
// (POST /hooks/maritime) enqueue immediate runs; grade changes notify through Keiki.
export function createSentinel({ db, orchestrator }) {
  async function tick({ orgId } = {}) {
    const due = (await db.query(
      `select * from agents where sentinel_enabled and archived_at is null and source is distinct from 'hand'
         and (sentinel_next_run_at is null or sentinel_next_run_at <= now()) ${orgId ? 'and org_id = $1' : ''}`,
      orgId ? [orgId] : []
    )).rows;
    const runs = [];
    for (const a of due) {
      await db.query(
        `update agents set sentinel_next_run_at = now() + make_interval(hours => sentinel_interval_hours) where id = $1`,
        [a.id]
      );
      runs.push({ agentId: a.id, runId: (await orchestrator.enqueue(a, { trigger: 'sentinel' })).runId });
    }
    return { due: due.length, runs };
  }

  let timer;
  function start() {
    const on = process.env.LOXE_INTERNAL_SCHEDULER || (process.env.NODE_ENV === 'production' ? '0' : '1');
    if (on !== '1' || timer) return;
    const everyMs = parseInt(process.env.LOXE_SCHEDULER_MS || '60000', 10);
    timer = setInterval(() => tick().catch((e) => console.warn(`[sentinel] ${e.message}`)), everyMs);
    timer.unref();
  }

  return { tick, start, stop: () => clearInterval(timer) };
}
