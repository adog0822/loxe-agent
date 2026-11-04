// LOXE WEB APP — Hono server
// Endpoints: agent registration, run trigger, status, public clearance page,
// badge SVG, PDF export, /verify (ledger chain), replay API.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import pg from 'pg';
import { id } from '../core/canonical.js';
import { Orchestrator } from '../orchestrator/index.js';
import { Ledger } from '../ledger/index.js';
import { generatePDF } from '../reporter/pdf.js';
import { generateBadge } from '../reporter/badge.js';

const { Pool } = pg;

export function createApp(config = {}) {
  const app = new Hono();
  const pool = new Pool({ connectionString: config.databaseUrl || process.env.DATABASE_URL });
  const ledger = new Ledger(pool);

  app.use('*', cors());

  // ── Health (Maritime contract: GET /health → 2xx) ────────────────────────
  app.get('/', (c) =>
    c.json({ name: 'loxe', version: '0.1.0', status: 'ok' })
  );
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // ── Maritime chat contract (POST /chat) ─────────────────────────────────
  app.post('/chat', async (c) => {
    const body = await c.req.json();
    const msg = (body.message || '').trim().toLowerCase();

    // Simple command router for Maritime / Keiki integration
    if (msg.startsWith('run clearance')) {
      const agentId = msg.replace('run clearance', '').trim();
      if (!agentId) return c.json({ response: 'Usage: run clearance <agent-id>' });
      const res = await pool.query('SELECT id, url FROM agents WHERE id = $1', [agentId]);
      if (res.rows.length === 0) return c.json({ response: `Agent ${agentId} not found. Use "list agents" to see registered agents.` });
      const agent = res.rows[0];
      const orchestrator = new Orchestrator({ db: pool, targetUrl: agent.url, agentId: agent.id });
      const result = await orchestrator.run({});
      return c.json({ response: `Clearance run complete for ${agentId}. Grade: ${result.reportCard.grade}. Run ID: ${result.runId}` });
    }

    if (msg === 'list agents') {
      const res = await pool.query('SELECT id, name, current_grade, last_run_at FROM agents ORDER BY name');
      if (res.rows.length === 0) return c.json({ response: 'No agents registered. POST /agents to register one.' });
      const list = res.rows.map(a => `• ${a.name} (${a.id}) — grade: ${a.current_grade || 'ungraded'}`).join('\n');
      return c.json({ response: `Registered agents:\n${list}` });
    }

    if (msg === 'help') {
      return c.json({ response: 'Loxe commands: "list agents", "run clearance <agent-id>", "help". API: POST /agents, POST /agents/:id/run, GET /clearance/:id' });
    }

    return c.json({ response: 'Loxe — deterministic agent clearance. Commands: "list agents", "run clearance <agent-id>", "help"' });
  });

  // ── Agent registration ───────────────────────────────────────────────────
  app.post('/agents', async (c) => {
    const body = await c.req.json();
    const { name, url, headers } = body;
    if (!name || !url) return c.json({ error: 'name and url required' }, 400);
    const agentId = id('agent');
    await pool.query(
      `INSERT INTO agents (id, name, url, headers, owner_id) VALUES ($1, $2, $3, $4, $5)`,
      [agentId, name, url, JSON.stringify(headers || {}), body.ownerId || 'default']
    );
    return c.json({ id: agentId, name, url }, 201);
  });

  app.get('/agents', async (c) => {
    const r = await pool.query(`SELECT id, name, url, current_grade, last_run_at, created_at FROM agents ORDER BY created_at DESC`);
    return c.json(r.rows);
  });

  app.get('/agents/:id', async (c) => {
    const r = await pool.query(`SELECT * FROM agents WHERE id = $1`, [c.req.param('id')]);
    if (!r.rows[0]) return c.json({ error: 'not found' }, 404);
    const agent = r.rows[0];
    agent.headers = undefined; // don't leak auth headers
    return c.json(agent);
  });

  // ── Trigger a clearance run ──────────────────────────────────────────────
  app.post('/agents/:id/run', async (c) => {
    const agentId = c.req.param('id');
    const agent = (await pool.query(`SELECT * FROM agents WHERE id = $1`, [agentId])).rows[0];
    if (!agent) return c.json({ error: 'agent not found' }, 404);

    const headers = agent.headers ? JSON.parse(agent.headers) : {};
    const orch = new Orchestrator({
      db: pool,
      targetUrl: agent.url,
      targetHeaders: headers,
      agentId,
    });

    // Run asynchronously — return runId immediately
    const runId = id('run');
    // But for MVP simplicity, we run synchronously and return the result
    try {
      const result = await orch.run();
      return c.json(result);
    } catch (err) {
      return c.json({ error: err.message }, 500);
    }
  });

  // ── Run status & history ─────────────────────────────────────────────────
  app.get('/runs/:id', async (c) => {
    const r = await pool.query(`SELECT * FROM runs WHERE id = $1`, [c.req.param('id')]);
    if (!r.rows[0]) return c.json({ error: 'not found' }, 404);
    const run = r.rows[0];
    if (run.report) run.report = JSON.parse(run.report);
    return c.json(run);
  });

  app.get('/agents/:id/runs', async (c) => {
    const r = await pool.query(
      `SELECT id, status, grade, started_at, finished_at, library_hash, library_version
       FROM runs WHERE agent_id = $1 ORDER BY started_at DESC LIMIT 50`,
      [c.req.param('id')]
    );
    return c.json(r.rows);
  });

  // ── Public clearance page (JSON) ─────────────────────────────────────────
  app.get('/clearance/:agentId', async (c) => {
    const agent = (await pool.query(
      `SELECT id, name, url, current_grade, last_run_id, last_run_at FROM agents WHERE id = $1`,
      [c.req.param('agentId')]
    )).rows[0];
    if (!agent) return c.json({ error: 'not found' }, 404);
    if (!agent.last_run_id) return c.json({ agent, message: 'no runs yet' });

    const run = (await pool.query(`SELECT * FROM runs WHERE id = $1`, [agent.last_run_id])).rows[0];
    const report = run?.report ? JSON.parse(run.report) : null;
    const chain = await ledger.verify(agent.id);

    return c.json({
      agent: { id: agent.id, name: agent.name, grade: agent.current_grade },
      run: {
        id: run.id,
        grade: run.grade,
        startedAt: run.started_at,
        finishedAt: run.finished_at,
        libraryVersion: run.library_version,
        libraryHash: run.library_hash,
      },
      report,
      chain,
      disclaimer:
        'This report states that the agent was cleared against the specified probe library ' +
        'on the date shown. It does not constitute certification, compliance, or approval.',
    });
  });

  // ── Public clearance page (HTML) ─────────────────────────────────────────
  app.get('/clearance/:agentId/page', async (c) => {
    const agent = (await pool.query(
      `SELECT id, name, current_grade, last_run_id, last_run_at FROM agents WHERE id = $1`,
      [c.req.param('agentId')]
    )).rows[0];
    if (!agent) return c.text('Agent not found', 404);

    const run = agent.last_run_id
      ? (await pool.query(`SELECT * FROM runs WHERE id = $1`, [agent.last_run_id])).rows[0]
      : null;
    const report = run?.report ? JSON.parse(run.report) : null;

    const gradeColor = { A: '#22c55e', B: '#84cc16', C: '#eab308', D: '#f97316', F: '#ef4444' };
    const gc = gradeColor[agent.current_grade] || '#6b7280';
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Loxe Clearance — ${agent.name}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,sans-serif;background:#0f172a;color:#e2e8f0;min-height:100vh;display:flex;justify-content:center;padding:2rem}
.card{max-width:640px;width:100%;background:#1e293b;border-radius:12px;padding:2rem;box-shadow:0 4px 24px rgba(0,0,0,.3)}
.grade{width:80px;height:80px;border-radius:50%;background:${gc};display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;color:#fff;margin:0 auto 1rem}
h1{text-align:center;font-size:1.5rem;margin-bottom:.5rem}
.meta{text-align:center;color:#94a3b8;font-size:.85rem;margin-bottom:1.5rem}
.stats{display:flex;gap:1rem;justify-content:center;margin-bottom:1.5rem}
.stat{text-align:center;padding:.5rem 1rem;background:#0f172a;border-radius:8px}
.stat-val{font-size:1.2rem;font-weight:600}
.stat-label{font-size:.7rem;color:#94a3b8;text-transform:uppercase}
.findings{border-top:1px solid #334155;padding-top:1rem}
.finding{padding:.5rem 0;border-bottom:1px solid #1e293b}
.pass{color:#22c55e}.fail{color:#ef4444}.inconclusive{color:#6b7280}
.disclaimer{margin-top:1.5rem;padding:1rem;background:#0f172a;border-radius:8px;font-size:.75rem;color:#64748b;text-align:center}
a{color:#38bdf8}
</style></head><body><div class="card">
<div class="grade">${agent.current_grade || '—'}</div>
<h1>${agent.name}</h1>
<div class="meta">${report ? `Cleared ${new Date(report.ts).toLocaleDateString()} · Library v${report.libraryVersion}` : 'No runs yet'}</div>
${report ? `
<div class="stats">
<div class="stat"><div class="stat-val">${report.passed}</div><div class="stat-label">Passed</div></div>
<div class="stat"><div class="stat-val">${report.failed}</div><div class="stat-label">Failed</div></div>
<div class="stat"><div class="stat-val">${report.inconclusive}</div><div class="stat-label">Inconclusive</div></div>
<div class="stat"><div class="stat-val">${report.total}</div><div class="stat-label">Total</div></div>
</div>
<div class="findings">
${report.findings.map(f => `<div class="finding"><span class="${f.status}">${f.status === 'pass' ? '✓' : f.status === 'fail' ? '✗' : '?'}</span> <strong>[${f.probeId}]</strong> ${f.plainEnglish}</div>`).join('')}
</div>` : ''}
<div class="disclaimer">This report states that the agent was cleared against the specified probe library on the date shown. It does not constitute certification, compliance, or approval by any standards body. <a href="/verify/${agent.id}">Verify the ledger chain →</a></div>
</div></body></html>`;
    return c.html(html);
  });

  // ── Badge SVG ────────────────────────────────────────────────────────────
  app.get('/badge/:agentId', async (c) => {
    const agent = (await pool.query(
      `SELECT current_grade FROM agents WHERE id = $1`,
      [c.req.param('agentId')]
    )).rows[0];
    const grade = agent?.current_grade || 'N/A';
    const svg = generateBadge(grade);
    return c.body(svg, 200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-cache, max-age=300',
    });
  });

  // ── PDF export ───────────────────────────────────────────────────────────
  app.get('/report/:runId/pdf', async (c) => {
    const run = (await pool.query(`SELECT * FROM runs WHERE id = $1`, [c.req.param('runId')])).rows[0];
    if (!run || !run.report) return c.text('Run not found or incomplete', 404);
    const report = JSON.parse(run.report);
    const pdf = await generatePDF(report);
    return c.body(pdf, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="loxe-${run.id}.pdf"`,
    });
  });

  // ── Verify ledger chain ──────────────────────────────────────────────────
  app.get('/verify/:agentId', async (c) => {
    const agentId = c.req.param('agentId');
    const chain = await ledger.verify(agentId);
    return c.json({ agentId, ...chain });
  });

  // ── Replay API (get raw transcripts for a run) ───────────────────────────
  app.get('/replay/:runId', async (c) => {
    const r = await pool.query(
      `SELECT probe_id, request_kind, response_body, status_code, latency_ms, created_at
       FROM vendor_requests WHERE run_id = $1 ORDER BY created_at ASC`,
      [c.req.param('runId')]
    );
    return c.json({ runId: c.req.param('runId'), transcripts: r.rows });
  });

  // ── Ledger entries for a run ─────────────────────────────────────────────
  app.get('/ledger/:runId', async (c) => {
    const entries = await ledger.entriesForRun(c.req.param('runId'));
    return c.json(entries);
  });

  return { app, pool };
}
