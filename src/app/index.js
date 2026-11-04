// LOXE WEB APP — Hono server. Route groups:
//   /api/*      authenticated, org-scoped product API (docs/API.md)
//   /a/:id, /badge, /verify, /report, /replay   public proof surfaces (no secrets)
//   /health, /chat, /schedules, /hooks/maritime, /sentinel/tick   machine contracts
//   /app/*      the product UI (static files in web/)
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import { id } from '../core/canonical.js';
import { createAuth, authProvider } from '../auth/index.js';
import { assertProbeable } from '../collector/guard.js';
import { Orchestrator } from '../orchestrator/index.js';
import { Ledger } from '../ledger/index.js';
import { signingKey } from '../ledger/signing.js';
import { controlsTable } from '../mapper/index.js';
import { generatePDF } from '../reporter/pdf.js';
import { generateBadge } from '../reporter/badge.js';
import { clearancePage } from '../reporter/page.js';
import { createSentinel } from '../sentinel/index.js';
import { integration, integrationStatus } from '../integrations/index.js';
import { createDemo } from '../demo/index.js';
import { demoFetch } from '../../demo/target-agent.js';
import { buildOwlMessages, askViaRest, OWL_MODEL } from '../guide/index.js';

export function createApp({ db, baseUrl }) {
  const app = new Hono();
  const auth = createAuth(db);
  const ledger = new Ledger(db);
  const orchestrator = new Orchestrator({ db, baseUrl });
  const sentinel = createSentinel({ db, orchestrator });
  const demo = createDemo({ db, orchestrator, baseUrl });

  const agentRow = async (agentId, orgId) =>
    (await db.query(
      `select * from agents where id = $1 and archived_at is null ${orgId ? 'and org_id = $2' : ''}`,
      orgId ? [agentId, orgId] : [agentId]
    )).rows[0];

  async function agentView(a) {
    const chain = await ledger.verify(a.id);
    return {
      id: a.id,
      name: a.name,
      url: a.url,
      source: a.source,
      maritimeAgentId: a.maritime_agent_id || undefined,
      grade: a.current_grade || null,
      lastRunId: a.last_run_id || null,
      lastRunStatus: a.last_run_id
        ? (await db.query(`select status from runs where id = $1`, [a.last_run_id])).rows[0]?.status || null
        : null,
      lastRunAt: a.last_run_at || null,
      sentinel: { enabled: a.sentinel_enabled, intervalHours: a.sentinel_interval_hours, nextRunAt: a.sentinel_next_run_at || null },
      chain: { valid: chain.valid, length: chain.length, head: chain.head },
      createdAt: a.created_at,
    };
  }

  function runView(r) {
    return {
      id: r.id,
      agentId: r.agent_id,
      status: r.status,
      progress: r.progress ? JSON.parse(r.progress) : null,
      grade: r.grade,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      error: r.error,
      trigger: r.trigger,
      libraryVersion: r.library_version,
      libraryHash: r.library_hash,
      report: r.report ? JSON.parse(r.report) : null,
    };
  }

  // Overlay recorded decisions (ledger 'decision' entries) onto a report's findings.
  async function withDecisions(run) {
    if (!run.report) return run;
    const rows = (await db.query(
      `select payload from ledger where agent_id = $1 and kind = 'decision' order by seq asc`, [run.agentId]
    )).rows.map((r) => JSON.parse(r.payload)).filter((d) => d.runId === run.id);
    for (const d of rows) {
      const f = run.report.findings.find((x) => x.probeId === d.probeId);
      if (f) f.decision = { state: d.state, by: d.by, at: d.ts, note: d.note };
    }
    return run;
  }

  // ── Machine contracts ──────────────────────────────────────────────────────
  app.get('/health', (c) => c.json({ status: 'ok' }));

  // The CLI is a single dependency-free file, served from this instance (npm's "loxe" is not ours).
  const cliSource = readFileSync(new URL('../../bin/loxe.js', import.meta.url), 'utf8').replace(/^#!.*\n/, '');
  app.get('/cli/loxe.mjs', (c) => c.body(cliSource, 200, { 'Content-Type': 'text/javascript; charset=utf-8' }));
  app.get('/', (c) => c.redirect('/app/'));

  // Maritime chat contract: a read-only command surface (runs need an authenticated call).
  app.post('/chat', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const msg = String(body.message || body.messages?.at?.(-1)?.content || '').trim();
    // Maritime's schedule wakes the VM by sending its prompt here; route it to the sentinel.
    if (await integration('maritime', 'isSentinelTick', msg)) {
      const r = await sentinel.tick();
      return c.json({ response: `Sentinel tick: ${r.due} agent(s) due, ${r.runs.length} run(s) queued.` });
    }
    const m = msg.match(/(agent-[0-9a-f]{12})/i);
    if (m) {
      const a = await agentRow(m[1].toLowerCase());
      if (!a) return c.json({ response: `No agent ${m[1]}.` });
      const chain = await ledger.verify(a.id);
      return c.json({
        response: `${a.name}: grade ${a.current_grade || 'not cleared yet'}. Ledger ${chain.valid ? 'verifies' : 'does NOT verify'} (${chain.length} entries). ${baseUrl}/a/${a.id}`,
      });
    }
    return c.json({ response: 'Send an agent id (agent-…) to get its clearance grade and ledger status.' });
  });

  app.get('/schedules', async (c) => c.json((await integration('maritime', 'schedules')) || []));

  app.post('/hooks/maritime', async (c) => {
    const raw = await c.req.text();
    const ok = await integration('maritime', 'verifyWebhook', raw, Object.fromEntries(c.req.raw.headers));
    if (!ok) return c.json({ error: 'bad signature' }, 401);
    const event = (await integration('maritime', 'parseWebhookEvent', raw)) || {};
    const maritimeId = event.agentId;
    const agents = (await db.query(
      `select * from agents where maritime_agent_id = $1 and archived_at is null`, [maritimeId]
    )).rows;
    const runs = [];
    for (const a of agents) runs.push((await orchestrator.enqueue(a, { trigger: `maritime:${event.event || "event"}` })).runId);
    return c.json({ received: true, runs });
  });

  app.post('/sentinel/tick', async (c) => {
    const secret = process.env.LOXE_SCHEDULE_SECRET;
    const header = c.req.header('authorization') || '';
    const viaSecret = secret && header === `Bearer ${secret}`;
    const who = viaSecret ? null : await auth.identify(c);
    if (!viaSecret && !who) return c.json({ error: 'unauthorized' }, 401);
    return c.json(await sentinel.tick({ orgId: who?.org.id }));
  });

  // ── Guided demo: a real agent, really cleared (see src/demo) ────────────
  app.all('/demo/agent/*', (c) => demoFetch(c.req.raw, '/demo/agent'));
  app.all('/demo/agent', (c) => demoFetch(c.req.raw, '/demo/agent'));
  app.get('/demo/ids', async (c) => c.json(await demo.ids()));
  app.get('/demo/report.pdf', async (c) => c.redirect(`/report/${(await demo.ids()).runId}/pdf`));
  app.get('/demo/page', async (c) => c.redirect(`/a/${(await demo.ids()).agentId}`));
  app.get('/demo/verify', async (c) => c.redirect(`/verify/${(await demo.ids()).agentId}`));

  // ── Public proof surfaces ──────────────────────────────────────────────────
  app.get('/.well-known/loxe-signing-key', async (c) => {
    const k = await signingKey(db);
    return c.json({ alg: 'Ed25519', keyId: k.keyId, publicKey: k.publicPem });
  });

  app.get('/a/:agentId', async (c) => {
    const a = await agentRow(c.req.param('agentId'));
    if (!a || !a.is_public) return c.html(clearancePage({ notFound: true }), 404);
    const run = a.last_run_id ? (await db.query(`select * from runs where id = $1`, [a.last_run_id])).rows[0] : null;
    const chain = await ledger.verify(a.id);
    return c.html(clearancePage({ agent: a, report: run?.report ? JSON.parse(run.report) : null, chain, baseUrl }));
  });
  app.get('/clearance/:agentId/page', (c) => c.redirect(`/a/${c.req.param('agentId')}`, 301));

  app.get('/clearance/:agentId', async (c) => {
    const a = await agentRow(c.req.param('agentId'));
    if (!a || !a.is_public) return c.json({ error: 'not found' }, 404);
    const run = a.last_run_id ? (await db.query(`select * from runs where id = $1`, [a.last_run_id])).rows[0] : null;
    return c.json({
      agent: { id: a.id, name: a.name, grade: a.current_grade },
      report: run?.report ? JSON.parse(run.report) : null,
      chain: await ledger.verify(a.id),
    });
  });

  app.get('/badge/:agentId', async (c) => {
    const a = await agentRow(c.req.param('agentId'));
    return c.body(generateBadge(a?.is_public ? a.current_grade || 'N/A' : 'N/A'), 200, {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'max-age=300',
    });
  });

  app.get('/report/:runId/pdf', async (c) => {
    const run = (await db.query(
      `select r.* from runs r join agents a on a.id = r.agent_id where r.id = $1 and a.is_public`, [c.req.param('runId')]
    )).rows[0];
    if (!run?.report) return c.text('Run not found or not finished', 404);
    const agent = await agentRow(run.agent_id);
    const view = await withDecisions(runView(run));
    const pdf = await generatePDF(view.report, { agentName: agent?.name || run.agent_id, baseUrl });
    return c.body(pdf, 200, {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="loxe-${run.id}.pdf"`,
    });
  });

  app.get('/verify', async (c) => {
    const hash = (c.req.query('hash') || '').trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(hash)) return c.json({ error: 'pass ?hash= with a 64-character SHA-256 hex hash' }, 400);
    return c.json(await ledger.findByHash(hash));
  });
  app.get('/verify/:agentId', async (c) => c.json({ agentId: c.req.param('agentId'), ...(await ledger.verify(c.req.param('agentId'))) }));
  app.get('/ledger/:agentId/export', async (c) => c.json(await ledger.export(c.req.param('agentId'))));

  app.get('/replay/:runId', async (c) => {
    const rows = (await db.query(
      `select probe_id, request_kind, request_body, response_body, status_code, latency_ms, created_at
       from vendor_requests where run_id = $1 order by created_at asc`,
      [c.req.param('runId')]
    )).rows;
    return c.json({
      runId: c.req.param('runId'),
      transcripts: rows.map((r) => ({ ...r, request_body: JSON.parse(r.request_body || 'null'), response_body: JSON.parse(r.response_body || 'null') })),
    });
  });

  // ── Product API (authenticated) ────────────────────────────────────────────
  const api = new Hono();

  api.get('/config', (c) =>
    c.json({ auth: { provider: authProvider(), publishableKey: process.env.CLERK_PUBLISHABLE_KEY || undefined }, baseUrl })
  );
  api.post('/dev/login', async (c) => {
    if (authProvider() !== 'dev') return c.json({ error: 'dev sign-in is off' }, 404);
    const { email } = await c.req.json().catch(() => ({}));
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return c.json({ error: 'enter an email address' }, 400);
    await auth.devLogin(c, email.toLowerCase());
    return c.json({ ok: true });
  });
  api.post('/dev/logout', (c) => {
    auth.devLogout(c);
    return c.json({ ok: true });
  });

  api.use('*', auth.requireAuth);
  const org = (c) => c.get('auth').org.id;

  api.get('/me', (c) => {
    const { user, org: o, via } = c.get('auth');
    return c.json({ user, org: o, via });
  });

  api.post('/keys', async (c) => {
    const { name } = await c.req.json().catch(() => ({}));
    return c.json(await auth.createApiKey(org(c), name || 'API key', c.get('auth').user.id), 201);
  });
  api.get('/keys', async (c) =>
    c.json((await db.query(
      `select id, name, prefix, created_at as "createdAt", last_used_at as "lastUsedAt" from api_keys where org_id = $1 and revoked_at is null order by created_at desc`,
      [org(c)]
    )).rows)
  );
  api.delete('/keys/:id', async (c) => {
    await db.query(`update api_keys set revoked_at = now() where id = $1 and org_id = $2`, [c.req.param('id'), org(c)]);
    return c.body(null, 204);
  });

  api.get('/agents', async (c) => {
    const rows = (await db.query(
      `select * from agents where org_id = $1 and archived_at is null order by created_at desc`, [org(c)]
    )).rows;
    return c.json(await Promise.all(rows.map(agentView)));
  });

  api.post('/agents', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    let { name, url, headers, source = 'url', maritimeAgentId } = body;
    if (source === 'maritime' && maritimeAgentId && !url) {
      const m = await integration('maritime', 'getAgent', maritimeAgentId);
      if (!m?.url) return c.json({ error: 'that Maritime agent has no public URL yet' }, 400);
      url = m.url;
      name ||= m.name;
    }
    if (!name || !url) return c.json({ error: 'name and url are required' }, 400);
    try {
      await assertProbeable(url);
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
    if (headers && typeof headers !== 'object') return c.json({ error: 'headers must be an object' }, 400);
    const agentId = id('agent');
    await db.query(
      `insert into agents (id, name, url, headers, owner_id, org_id, source, maritime_agent_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [agentId, String(name).slice(0, 120), url, JSON.stringify(headers || {}), c.get('auth').user.id, org(c), source, maritimeAgentId || null]
    );
    return c.json(await agentView(await agentRow(agentId)), 201);
  });

  api.get('/agents/:id', async (c) => {
    const a = await agentRow(c.req.param('id'), org(c));
    return a ? c.json(await agentView(a)) : c.json({ error: 'not found' }, 404);
  });

  api.delete('/agents/:id', async (c) => {
    await db.query(`update agents set archived_at = now() where id = $1 and org_id = $2`, [c.req.param('id'), org(c)]);
    return c.body(null, 204);
  });

  api.post('/agents/:id/runs', async (c) => {
    const a = await agentRow(c.req.param('id'), org(c));
    if (!a) return c.json({ error: 'not found' }, 404);
    const { runId, status } = await orchestrator.enqueue(a, { trigger: 'manual' });
    return c.json({ runId, status }, 202);
  });

  api.get('/agents/:id/runs', async (c) =>
    c.json((await db.query(
      `select id, status, grade, started_at, finished_at, library_version, trigger from runs
       where agent_id = $1 and org_id = $2 order by started_at desc limit 50`,
      [c.req.param('id'), org(c)]
    )).rows)
  );

  // Full chain for the in-browser verify trace: the browser recomputes every entry hash.
  api.get('/agents/:id/ledger', async (c) => {
    const a = await agentRow(c.req.param('id'), org(c));
    if (!a) return c.json({ error: 'not found' }, 404);
    const rows = (await db.query(
      `select seq, kind, prev_hash, payload_hash, entry_hash, payload, created_at from ledger where agent_id = $1 order by seq asc`,
      [a.id]
    )).rows;
    return c.json({
      entries: rows.map((r) => {
        const p = JSON.parse(r.payload);
        return {
          seq: r.seq, kind: r.kind, prevHash: r.prev_hash, payloadHash: r.payload_hash, entryHash: r.entry_hash,
          label: r.kind === 'decision' ? `Decision on ${p.probeId}: ${p.state}` : `${p.probeId} ${p.title}`,
          ts: r.created_at, payload: r.payload,
        };
      }),
    });
  });

  api.post('/agents/:id/sentinel', async (c) => {
    const a = await agentRow(c.req.param('id'), org(c));
    if (!a) return c.json({ error: 'not found' }, 404);
    const { enabled, intervalHours } = await c.req.json().catch(() => ({}));
    const hours = Math.min(Math.max(parseInt(intervalHours ?? a.sentinel_interval_hours, 10) || 24, 1), 24 * 30);
    const r = (await db.query(
      `update agents set sentinel_enabled = $1, sentinel_interval_hours = $2,
         sentinel_next_run_at = case when $1 then now() + make_interval(hours => $2) else null end, updated_at = now()
       where id = $3 returning sentinel_enabled, sentinel_interval_hours, sentinel_next_run_at`,
      [!!enabled, hours, a.id]
    )).rows[0];
    return c.json({ enabled: r.sentinel_enabled, intervalHours: r.sentinel_interval_hours, nextRunAt: r.sentinel_next_run_at });
  });

  api.get('/runs/:id', async (c) => {
    const r = (await db.query(`select * from runs where id = $1 and org_id = $2`, [c.req.param('id'), org(c)])).rows[0];
    return r ? c.json(await withDecisions(runView(r))) : c.json({ error: 'not found' }, 404);
  });

  api.post('/runs/:id/replay/:probeId', async (c) => {
    const r = (await db.query(`select * from runs where id = $1 and org_id = $2`, [c.req.param('id'), org(c)])).rows[0];
    if (!r) return c.json({ error: 'not found' }, 404);
    const a = await agentRow(r.agent_id, org(c));
    try {
      return c.json(await orchestrator.replay(r, a, c.req.param('probeId')));
    } catch (err) {
      return c.json({ error: err.message }, 400);
    }
  });

  const DECISIONS = ['open', 'accepted_exception', 'fix_proposed', 'resolved'];
  api.post('/runs/:id/findings/:probeId/decision', async (c) => {
    const r = (await db.query(`select * from runs where id = $1 and org_id = $2`, [c.req.param('id'), org(c)])).rows[0];
    if (!r?.report) return c.json({ error: 'run not found or not finished' }, 404);
    const probeId = c.req.param('probeId');
    if (!JSON.parse(r.report).findings.some((f) => f.probeId === probeId)) return c.json({ error: 'no such finding' }, 404);
    const { state, note } = await c.req.json().catch(() => ({}));
    if (!DECISIONS.includes(state)) return c.json({ error: `state must be one of ${DECISIONS.join(', ')}` }, 400);
    const who = c.get('auth').user;
    const decision = { type: 'decision', agentId: r.agent_id, runId: r.id, probeId, state, note: String(note || '').slice(0, 2000), by: who.email || who.id, ts: new Date().toISOString() };
    const entry = await ledger.append(r.agent_id, decision, { kind: 'decision', runId: r.id });
    await integration('supermemory', 'rememberDecision', { orgId: org(c), agentId: r.agent_id, probeId, state, note: decision.note });
    return c.json({ state, by: decision.by, at: decision.ts, note: decision.note, ledgerSeq: entry.seq, entryHash: entry.entry_hash });
  });

  api.get('/integrations', async (c) => c.json({ ...(await integrationStatus()), auth: { provider: authProvider() } }));
  api.get('/maritime/agents', async (c) => c.json((await integration('maritime', 'listAgents')) || []));
  api.get('/memory/:agentId', async (c) => {
    const a = await agentRow(c.req.param('agentId'), org(c));
    if (!a) return c.json({ error: 'not found' }, 404);
    return c.json((await integration('supermemory', 'recallAgent', { orgId: org(c), agentId: a.id })) || { items: [] });
  });
  api.get('/controls', (c) => c.json(controlsTable()));

  // Owl guide. /owl/context is what the Cloudflare Worker calls before running Workers AI;
  // /owl answers directly when this server has Workers AI REST credentials (local dev).
  async function owlMessages(c) {
    const body = await c.req.json().catch(() => ({}));
    if (!body.question) return { error: 'question is required' };
    const ctx = body.context || {};
    let run = null;
    if (ctx.runId) run = (await db.query(`select * from runs where id = $1 and org_id = $2`, [ctx.runId, org(c)])).rows[0];
    else if (ctx.agentId) {
      const a = await agentRow(ctx.agentId, org(c));
      if (a?.last_run_id) run = (await db.query(`select * from runs where id = $1`, [a.last_run_id])).rows[0];
    }
    return { messages: buildOwlMessages({ question: body.question, route: ctx.route, run: run && runView(run), probeId: ctx.probeId }) };
  }
  api.post('/owl/context', async (c) => {
    const m = await owlMessages(c);
    return m.error ? c.json(m, 400) : c.json({ model: OWL_MODEL, ...m });
  });
  api.post('/owl', async (c) => {
    const m = await owlMessages(c);
    if (m.error) return c.json(m, 400);
    try {
      const answer = await askViaRest(m.messages);
      return answer ? c.json({ answer }) : c.json({ error: 'guide unavailable: no model configured on this server' }, 503);
    } catch (err) {
      return c.json({ error: `guide unavailable: ${err.message}` }, 503);
    }
  });

  app.route('/api', api);

  // ── Product UI ─────────────────────────────────────────────────────────────
  app.get('/app', (c) => c.redirect('/app/'));
  app.use('/app/*', async (c, next) => {
    await next();
    c.header('Cache-Control', 'no-cache'); // releases replace these files in place
  });
  app.use('/app/*', serveStatic({ root: './web', rewriteRequestPath: (p) => p.replace(/^\/app/, '') }));

  return { app, orchestrator, sentinel, demo };
}
