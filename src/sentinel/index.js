// SENTINEL — continuous re-run scheduler + deploy webhook handler.
// On Maritime, sentinel uses /schedules (cron) to periodically re-clear agents.
// Deploy webhooks trigger an immediate re-run when an agent is redeployed.
import { Hono } from 'hono';
import pg from 'pg';
import { Orchestrator } from '../orchestrator/index.js';

const { Pool } = pg;

export function createSentinel(config = {}) {
  const app = new Hono();
  const pool = new Pool({ connectionString: config.databaseUrl || process.env.DATABASE_URL });

  // ── Webhook: deploy trigger ──────────────────────────────────────────────
  // When an agent is redeployed, hit POST /sentinel/webhook/:agentId
  // to trigger an immediate re-clearance run.
  app.post('/sentinel/webhook/:agentId', async (c) => {
    const agentId = c.req.param('agentId');
    const agent = (await pool.query(`SELECT * FROM agents WHERE id = $1`, [agentId])).rows[0];
    if (!agent) return c.json({ error: 'agent not found' }, 404);

    const headers = agent.headers ? JSON.parse(agent.headers) : {};
    const orch = new Orchestrator({
      db: pool,
      targetUrl: agent.url,
      targetHeaders: headers,
      agentId,
    });

    try {
      const result = await orch.run();
      // Notify via Keiki if grade changed
      if (agent.current_grade && result.reportCard.grade !== agent.current_grade) {
        await notifyGradeChange(agentId, agent.name, agent.current_grade, result.reportCard.grade, config);
      }
      return c.json({ status: 'completed', runId: result.runId, grade: result.reportCard.grade });
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // ── Scheduled re-run (called by Maritime cron) ───────────────────────────
  // POST /sentinel/scheduled — re-runs all agents with sentinel_enabled=true.
  app.post('/sentinel/scheduled', async (c) => {
    const agents = (await pool.query(
      `SELECT * FROM agents WHERE sentinel_enabled = true`
    )).rows;

    const results = [];
    for (const agent of agents) {
      const headers = agent.headers ? JSON.parse(agent.headers) : {};
      const orch = new Orchestrator({
        db: pool,
        targetUrl: agent.url,
        targetHeaders: headers,
        agentId: agent.id,
      });
      try {
        const result = await orch.run();
        results.push({ agentId: agent.id, grade: result.reportCard.grade, runId: result.runId });
        // Notify on grade change
        if (agent.current_grade && result.reportCard.grade !== agent.current_grade) {
          await notifyGradeChange(agent.id, agent.name, agent.current_grade, result.reportCard.grade, config);
        }
      } catch (err) {
        results.push({ agentId: agent.id, error: err.message });
      }
    }
    return c.json({ ran: results.length, results });
  });

  // ── Sentinel status ──────────────────────────────────────────────────────
  app.get('/sentinel/status', async (c) => {
    const agents = (await pool.query(
      `SELECT id, name, current_grade, sentinel_enabled, last_run_at FROM agents WHERE sentinel_enabled = true`
    )).rows;
    return c.json({ sentinelAgents: agents.length, agents });
  });

  // ── Enable/disable sentinel for an agent ─────────────────────────────────
  app.post('/sentinel/agents/:agentId/enable', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const interval = body.intervalHours || 24;
    await pool.query(
      `UPDATE agents SET sentinel_enabled = true, sentinel_interval_hours = $1 WHERE id = $2`,
      [interval, c.req.param('agentId')]
    );
    return c.json({ enabled: true, intervalHours: interval });
  });

  app.post('/sentinel/agents/:agentId/disable', async (c) => {
    await pool.query(
      `UPDATE agents SET sentinel_enabled = false WHERE id = $1`,
      [c.req.param('agentId')]
    );
    return c.json({ enabled: false });
  });

  return { app: app, pool };
}

// ── Keiki notification helper ──────────────────────────────────────────────
async function notifyGradeChange(agentId, agentName, oldGrade, newGrade, config) {
  const keikiUrl = config.keikiUrl || process.env.KEIKI_API_URL;
  const keikiKey = config.keikiKey || process.env.KEIKI_API_KEY;
  if (!keikiUrl || !keikiKey) return;

  const direction = newGrade < oldGrade ? 'improved' : 'degraded';
  try {
    await fetch(`${keikiUrl}/api/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${keikiKey}`,
      },
      body: JSON.stringify({
        type: 'grade_change',
        agentId,
        agentName,
        oldGrade,
        newGrade,
        direction,
        message: `Agent "${agentName}" grade ${direction}: ${oldGrade} → ${newGrade}`,
      }),
    });
  } catch {
    // Best-effort notification
  }
}
