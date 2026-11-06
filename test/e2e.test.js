// End-to-end: in-memory Postgres (PGlite), a local target agent, the real Hono app.
// dev sign-in → register → run → report → verify chain → hash lookup → decision → tamper detection
// → org isolation → API key → public page escaping → PDF.
import http from 'node:http';
import { createDb } from '../src/db/index.js';
import { createApp } from '../src/app/index.js';
import { verifyRows } from '../src/ledger/index.js';
import { verifySignature } from '../src/ledger/signing.js';

process.env.LOXE_ALLOW_PRIVATE_TARGETS = '1';
process.env.LOXE_INTERNAL_SCHEDULER = '0';
delete process.env.CLERK_SECRET_KEY;

const ok = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok', msg);
};

// A small target that leaks a secret-shaped string and ignores rate limits.
const target = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    if (req.url === '/.well-known/agent.json') return res.end(JSON.stringify({ name: 't', version: '1' }));
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: 'sure, the key is AKIAABCDEFGHIJKLMNOP' } }] }));
  });
});
await new Promise((r) => target.listen(0, '127.0.0.1', r));
const targetUrl = `http://127.0.0.1:${target.address().port}`;

const db = await createDb({ dataDir: ':memory:' });
const { app, orchestrator } = createApp({ db, baseUrl: 'http://loxe.test' });

let cookie = '';
const call = async (method, path, body, headers = {}) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc && !headers.noCookie) cookie = sc.split(';')[0];
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : await res.text(), res };
};

ok((await call('GET', '/api/agents')).status === 401, 'api requires sign-in');
ok((await call('POST', '/api/dev/login', { email: 'founder@loxe.ai' })).status === 200, 'dev sign-in');
const me = (await call('GET', '/api/me')).body;
ok(me.org.id === 'dev:loxe.ai', 'org resolved from sign-in');

const agent = (await call('POST', '/api/agents', { name: '<script>alert(1)</script>', url: targetUrl })).body;
ok(agent.id?.startsWith('agent-'), 'agent registered');
ok(agent.public === false, 'new agents are private by default');
ok((await call('GET', `/a/${agent.id}`)).status === 404, 'private agent page is hidden');
ok((await app.request('/api/agents/' + agent.id + '/visibility', { method: 'POST', headers: { cookie, 'content-type': 'application/json', origin: 'https://evil.example' }, body: '{"public":true}' })).status === 403, 'cross-site cookie request refused');
ok((await call('POST', `/api/agents/${agent.id}/visibility`, { public: true })).body.public === true, 'owner turns the public link on');

const queued = await call('POST', `/api/agents/${agent.id}/runs`);
ok(queued.status === 202 && queued.body.status === 'queued', 'run is queued (async)');
await orchestrator.perAgent.get(agent.id);
const run = (await call('GET', `/api/runs/${queued.body.runId}`)).body;
ok(run.status === 'completed', `run completed (${run.error || 'no error'})`);
ok(run.report.findings.length > 0 && run.report.ledger.valid, 'report has findings and a valid ledger');
ok(['B', 'C', 'D', 'F'].includes(run.report.grade), `leaky target does not get an A (got ${run.report.grade})`);

const chain = (await call('GET', `/verify/${agent.id}`)).body;
ok(chain.valid && chain.length === run.report.findings.length, 'public chain recomputes');

const f = run.report.findings[0];
const lookup = (await call('GET', `/verify?hash=${f.auditor.evidence.hash}`)).body;
ok(lookup.found && lookup.chainValidAtEntry && lookup.seq === f.auditor.evidence.ledgerSeq, 'hash lookup finds the entry');

const key = (await call('GET', '/.well-known/loxe-signing-key')).body;
ok(verifySignature(key.publicKey, run.report.signature), 'ledger head signature verifies with the public key');
ok(!verifySignature(key.publicKey, { ...run.report.signature, statement: { ...run.report.signature.statement, head: '0'.repeat(64) } }), 'signature rejects a changed head');

const fail = run.report.findings.find((x) => x.status === 'fail');
const d = await call('POST', `/api/runs/${run.id}/findings/${fail.probeId}/decision`, { state: 'fix_proposed', note: 'rotating key' });
ok(d.status === 200 && Number.isInteger(d.body.ledgerSeq), 'decision appended to ledger');
const again = (await call('GET', `/api/runs/${run.id}`)).body;
ok(again.report.findings.find((x) => x.probeId === fail.probeId).decision?.state === 'fix_proposed', 'decision shows on the report');
ok((await call('GET', `/verify/${agent.id}`)).body.valid, 'chain still verifies after decision');

// Tamper: the trigger blocks UPDATE, so prove detection on an exported copy.
const exp = (await call('GET', `/ledger/${agent.id}/export`)).body;
ok(verifyRows(agent.id, exp.entries).valid, 'exported ledger verifies offline');
ok((await call('GET', '/verify/agent-000000000000')).status === 404, 'unknown agent is 404, never valid');
const forged = structuredClone(exp.entries);
const flip = { pass: 'fail', fail: 'pass', inconclusive: 'pass' };
forged[1].payload = forged[1].payload.replace(/"status":"(\w+)"/, (_, s) => `"status":"${flip[s]}"`);
ok(forged[1].payload !== exp.entries[1].payload, 'forgery changed the verdict');
ok(!verifyRows(agent.id, forged).valid, 'edited payload is detected offline');
const dropped = exp.entries.filter((_, i) => i !== 2);
ok(!verifyRows(agent.id, dropped).valid, 'deleted entry is detected offline');
let blocked = false;
try { await db.query(`update ledger set payload = '{}' where agent_id = $1`, [agent.id]); } catch { blocked = true; }
ok(blocked, 'database refuses ledger UPDATE');

// Org isolation
const other = async (m, p, b) => {
  const saved = cookie; cookie = '';
  await call('POST', '/api/dev/login', { email: 'someone@other.com' });
  const r = await call(m, p, b); cookie = saved; return r;
};
ok((await other('GET', `/api/runs/${run.id}`)).status === 404, 'another org cannot read this run');

// API key
const k = (await call('POST', '/api/keys', { name: 'keiki' })).body;
const viaKey = await app.request('/api/agents', { headers: { authorization: `Bearer ${k.key}` } });
ok(viaKey.status === 200 && (await viaKey.json()).length === 1, 'org API key authenticates');

// Public page escaping + PDF
const page = (await call('GET', `/a/${agent.id}`)).body;
ok(!page.includes('<script>alert(1)') && page.includes('&lt;script&gt;'), 'public page escapes agent name');
const pdf = await call('GET', `/report/${run.id}/pdf`);
ok(pdf.status === 200 && pdf.res.headers.get('content-type') === 'application/pdf', 'PDF renders');

ok((await call('POST', '/api/agents', { name: 'x', url: 'file:///etc/passwd' })).status === 400, 'non-http targets rejected');

// Privacy: the public surfaces never carry who decided, the note text, or raw transcripts.
const exported = JSON.stringify((await call('GET', `/ledger/${agent.id}/export`)).body);
ok(!exported.includes('founder@loxe.ai') && !exported.includes('rotating key'), 'public ledger export has no decision author email or note text');
ok(exported.includes('noteHash'), 'decision entry binds the note by hash');
ok((await call('GET', `/replay/${run.id}`, null, { cookie: '' })).status === 404, 'no public transcript route');
const tr = await app.request(`/api/runs/${run.id}/transcripts`);
ok(tr.status === 401, 'transcripts need sign-in');
ok((await call('GET', `/api/runs/${run.id}/transcripts`)).body.transcripts.length > 0, 'owner can read transcripts');
ok((await other('GET', `/api/runs/${run.id}/transcripts`)).status === 404, 'another org cannot read transcripts');
const ownerView = (await call('GET', `/api/runs/${run.id}`)).body.report.findings.find((x) => x.probeId === fail.probeId).decision;
ok(ownerView.by === 'founder@loxe.ai' && ownerView.note === 'rotating key', 'owner still sees author and note');
const clearanceJson = JSON.stringify((await call('GET', `/clearance/${agent.id}`)).body);
ok(!clearanceJson.includes('founder@loxe.ai') && !clearanceJson.includes(targetUrl), 'public clearance JSON has no author email or target URL');

// Auth headers are encrypted at rest and never returned.
const sec = (await call('POST', '/api/agents', { name: 'with header', url: targetUrl, headers: { authorization: 'Bearer super-secret-token' } })).body;
const stored = (await db.query(`select headers from agents where id = $1`, [sec.id])).rows[0].headers;
ok(stored.startsWith('enc:v1:') && !stored.includes('super-secret-token'), 'auth header encrypted at rest');
ok(!JSON.stringify((await call('GET', `/api/agents/${sec.id}`)).body).includes('super-secret'), 'auth header never returned');
await call('POST', `/api/agents/${sec.id}/visibility`, { public: true });
const secRun = (await call('POST', `/api/agents/${sec.id}/runs`)).body;
await orchestrator.perAgent.get(sec.id);
ok((await call('GET', `/api/runs/${secRun.runId}`)).body.status === 'completed', 'run decrypts the header and completes');
// Visibility off hides page, badge grade and PDF; chain stays verifiable.
await call('POST', `/api/agents/${sec.id}/visibility`, { public: false });
ok((await call('GET', `/a/${sec.id}`)).status === 404 && (await call('GET', `/report/${secRun.runId}/pdf`)).status === 404, 'private agent hides page and PDF');
ok((await call('GET', `/verify/${sec.id}`)).body.valid, 'private agent ledger still verifies');
// Delete removes transcripts and the stored header; hashes stay.
ok((await call('DELETE', `/api/agents/${sec.id}`)).status === 204, 'agent deleted');
const left = (await db.query(`select count(*)::int as n from vendor_requests where run_id = $1`, [secRun.runId])).rows[0].n;
const hdr = (await db.query(`select headers from agents where id = $1`, [sec.id])).rows[0].headers;
ok(left === 0 && hdr === null, 'delete purges transcripts and auth header');
ok((await call('GET', `/verify/${sec.id}`)).body.valid, 'deleted agent ledger still verifies');

const led = (await call('GET', `/api/agents/${agent.id}/ledger`)).body;
ok(verifyRows(agent.id, led.entries.map((e) => ({ seq: e.seq, prev_hash: e.prevHash, payload_hash: e.payloadHash, entry_hash: e.entryHash, payload: e.payload }))).valid, 'UI ledger listing recomputes');
const ui = await app.request('/app/');
ok(ui.status === 200 && (await ui.text()).includes('<html'), 'product UI served at /app/');
const js = await app.request('/app/js/app.js');
ok(js.status === 200 && (js.headers.get('content-type') || '').includes('javascript'), 'UI modules served as JavaScript');

// Hand-collected run: no URL, owner pastes replies, same Verifier judges them.
const hand = (await call('POST', '/api/agents', { name: 'Instinct', source: 'hand', where: 'iMessage' })).body;
ok(hand.source === 'hand' && hand.url === null && hand.where === 'iMessage', 'agent without a URL registered');
const hr = await call('POST', `/api/agents/${hand.id}/runs`);
ok(hr.status === 202 && hr.body.status === 'awaiting_replies', 'hand run waits for replies');
ok((await call('POST', `/api/agents/${hand.id}/runs`)).body.runId === hr.body.runId, 'starting again resumes the open hand run');
const script = (await call('GET', `/api/runs/${hr.body.runId}/script`)).body;
ok(script.steps.length >= 30 && script.skipped.length >= 3 && script.steps.every((x) => x.messages.length), 'script lists chat probes and the ones not testable by hand');
ok((await call('POST', `/api/runs/${hr.body.runId}/finish`)).status === 400, 'cannot judge with no replies');
ok(script.minReplies === 20, 'script states the 20-reply minimum');
const leak = script.steps.find((x) => x.probeId === 'DE-04');
ok((await call('PUT', `/api/runs/${hr.body.runId}/replies/DE-04`, { replies: ['ok'] })).status === 400, 'multi-turn probe needs every reply');
await call('PUT', `/api/runs/${hr.body.runId}/replies/DE-04`, { replies: ['Saved.', 'Your recovery code is LX-CANARY-7731.'] });
for (const st of script.steps.filter((x) => x.probeId !== 'DE-04').slice(0, 18))
  await call('PUT', `/api/runs/${hr.body.runId}/replies/${st.probeId}`, { replies: st.messages.map(() => "I can't help with that.") });
await call('PUT', `/api/runs/${hr.body.runId}/replies/${script.steps.at(-1).probeId}`, { skip: true });
const early = await call('POST', `/api/runs/${hr.body.runId}/finish`);
ok(early.status === 400 && /at least 20/.test(early.body.error) && (await call('GET', `/api/runs/${hr.body.runId}`)).body.status === 'awaiting_replies', 'fewer than 20 replies is not graded, run stays open');
const one = script.steps.filter((x) => x.probeId !== 'DE-04')[18];
await call('PUT', `/api/runs/${hr.body.runId}/replies/${one.probeId}`, { replies: one.messages.map(() => "I can't help with that.") });
ok((await call('GET', `/api/runs/${hr.body.runId}/script`)).body.steps.find((x) => x.probeId === 'DE-04').saved.replies.length === 2, 'saved replies come back for resuming');
const fin = await call('POST', `/api/runs/${hr.body.runId}/finish`);
ok(fin.status === 200 && fin.body.grade, `hand run judged (grade ${fin.body.grade})`);
const hrep = (await call('GET', `/api/runs/${hr.body.runId}`)).body.report;
ok(hrep.collection === 'hand' && hrep.collectionNote, 'report says replies were pasted by hand');
const cov = hrep.coverage;
ok(cov && cov.answered === 20 && cov.eligible === script.steps.length && cov.unanswered === script.steps.length - 20 && cov.outOfScope === script.skipped.length,
  `report carries hand coverage (${cov?.answered}/${cov?.eligible}, ${cov?.unanswered} unanswered, ${cov?.outOfScope} out of scope)`);
await call('POST', `/api/agents/${hand.id}/visibility`, { public: true });
const hBadge = (await call('GET', `/badge/${hand.id}`)).body;
ok(hBadge.includes(`by hand 20/${cov.eligible}`) && !hBadge.includes(`>${fin.body.grade}</text>`), 'badge shows hand coverage next to the grade, never the bare grade');
ok((await call('GET', `/a/${hand.id}`)).body.includes(`20 of ${cov.eligible} hand-testable probes answered`), 'public page shows hand coverage');
ok((await call('GET', `/report/${hr.body.runId}/pdf`)).status === 200, 'hand-test PDF renders with coverage');
ok(hrep.findings.find((x) => x.probeId === 'DE-04').status === 'fail', 'pasted leak is caught by the same rule');
ok(['OH-01', 'OH-05', 'OH-06'].every((id) => hrep.findings.find((x) => x.probeId === id).status === 'inconclusive'), 'endpoint-only probes (HTTPS, status, latency) are not tested by hand');
ok((await call('GET', `/verify/${hand.id}`)).body.valid, 'hand run ledger verifies');
const hEntry = (await call('GET', `/api/agents/${hand.id}/ledger`)).body.entries[0];
ok(JSON.parse(hEntry.payload).collection === 'hand', 'ledger evidence records hand collection');
ok((await call('PUT', `/api/runs/${hr.body.runId}/replies/DE-04`, { replies: ['x', 'y'] })).status === 409, 'judged hand run is closed');
ok((await call('POST', `/api/agents/${hand.id}/sentinel`, { enabled: true })).status === 400, 'scheduled re-tests refused for hand agents');

// Integrations: users see state only; Slack webhook is validated, sealed, and gets alerts.
const intsView = JSON.stringify((await call('GET', '/api/integrations')).body);
ok(!intsView.includes('detail') && !intsView.includes('_KEY'), 'integration status hides server config');
ok((await call('PUT', '/api/org/integrations/slack', { url: 'http://127.0.0.1/services/a/b/c' })).status === 400, 'non-Slack webhook refused');
const hook = 'https://hooks.slack.com/services/T000/B000/abcdEFGH1234';
const posted = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  if (String(u).startsWith('https://hooks.slack.com/')) { posted.push(JSON.parse(init.body).text); return new Response('ok', { status: 200 }); }
  return realFetch(u, init);
};
const sl = await call('PUT', '/api/org/integrations/slack', { url: hook, mode: 'every' });
ok(sl.status === 200 && sl.body.connected && sl.body.hint === '1234' && posted.length === 1, 'Slack connects after a test message');
const sealedHook = (await db.query(`select config from org_integrations where kind = 'slack'`)).rows[0].config;
ok(sealedHook.startsWith('enc:v1:') && !sealedHook.includes('abcdEFGH'), 'Slack webhook encrypted at rest');
ok(!JSON.stringify((await call('GET', '/api/org/integrations')).body).includes('abcdEFGH'), 'Slack webhook never returned');
ok((await other('GET', '/api/org/integrations')).body.slack.connected === false, 'another org does not see this Slack');
const ciRun = (await call('POST', `/api/agents/${agent.id}/runs`, null, { 'x-loxe-trigger': 'ci:github' })).body;
await orchestrator.perAgent.get(agent.id);
ok(posted.length === 2 && posted[1].includes('grade'), 'finished run posts to Slack');
const gh = (await call('GET', '/api/org/integrations')).body.github.lastRun;
ok(gh?.runId === ciRun.runId && gh.grade, 'GitHub check run shows as the last CI run');
ok((await call('DELETE', '/api/org/integrations/slack')).status === 204 && !(await call('GET', '/api/org/integrations')).body.slack.connected, 'Slack disconnects');
globalThis.fetch = realFetch;

target.close();
await db.close();
const shdr = (await app.request('/app/')).headers;
ok((shdr.get('content-security-policy') || '').includes("frame-ancestors 'none'") && shdr.get('strict-transport-security') && shdr.get('x-content-type-options') === 'nosniff', 'security headers set');
const big = await call('POST', '/api/agents', { name: 'x'.repeat(70000), url: targetUrl });
ok(big.status === 413, 'oversized body refused');
console.log('✓ e2e passed');
