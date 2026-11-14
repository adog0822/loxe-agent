// Endpoint check: the add-agent screen's hello. Each common mix-up gets its own plain answer, a
// Vercel AI SDK v5 route is detected and then tested in its own format end to end, and the check
// is signed-in only.
import http from 'node:http';
import { checkEndpoint } from '../src/collector/check.js';
import { createDb } from '../src/db/index.js';
import { createApp } from '../src/app/index.js';

process.env.LOXE_ALLOW_PRIVATE_TARGETS = '1';
process.env.LOXE_INTERNAL_SCHEDULER = '0';
delete process.env.CLERK_SECRET_KEY;

const ok = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok', msg);
};

const server = http.createServer(async (req, res) => {
  let b = '';
  for await (const ch of req) b += ch;
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  switch (req.url) {
    case '/': return send(200, '<!doctype html><html><body>My startup</body></html>', 'text/html');
    case '/locked': return send(401, { error: 'unauthorized' });
    case '/openai': return send(200, { choices: [{ message: { content: 'Hello from the agent!' } }] });
    case '/empty': return send(200, { response: '' });
    case '/odd': return send(200, { result_v2: { blob: 'hi' } });
    case '/crash': return send(500, { error: 'TypeError: messages.map is not a function' });
    case '/get-only': return send(405, 'Method Not Allowed', 'text/plain');
    case '/stream': {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      for (const p of ['Hel', 'lo ', 'there']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: p } }] })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    case '/aisdk': {
      // AI SDK v5 route: messages must carry parts; the OpenAI shape makes it throw.
      let msgs;
      try { msgs = JSON.parse(b || '{}').messages || []; } catch { return send(400, { error: 'bad json' }); }
      if (!msgs.every((m) => Array.isArray(m.parts))) return send(500, { error: 'Cannot read properties of undefined (reading \'map\')' });
      const said = msgs.flatMap((m) => m.parts).map((p) => p.text).join(' ');
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const reply = /LX-CANARY-7731/.test(said) ? 'Your code is LX-CANARY-7731' : 'Hi there';
      for (const piece of reply.match(/.{1,4}/g)) res.write(`data: ${JSON.stringify({ type: 'text-delta', id: 't', delta: piece })}\n\n`);
      return res.end('data: [DONE]\n\n');
    }
    default: return send(404, 'Not Found', 'text/plain');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const c = async (path) => checkEndpoint({ url: base + path });
ok((await checkEndpoint({ url: 'https://github.com/acme/agent' })).kind === 'repo', 'GitHub repo is caught before any request');
ok((await checkEndpoint({ url: 'https://vercel.com/acme/agent' })).kind === 'dashboard', 'Vercel dashboard is caught');
ok((await checkEndpoint({ url: 'https://console.aws.amazon.com/athena/home' })).kind === 'console', 'AWS console / Athena is caught');
ok((await checkEndpoint({ url: 'not a url' })).kind === 'invalid', 'garbage input is caught');
ok((await c('/')).kind === 'website', 'a homepage returning HTML is called a web page');
ok((await c('/missing')).kind === 'not_found', 'a 404 route says nothing lives there');
const locked = await c('/locked');
ok(locked.kind === 'auth' && !locked.ok, 'a 401 says it wants a login');
ok((await c('/get-only')).kind === 'method', 'a 405 says it does not take messages');
ok((await c('/crash')).kind === 'server_error', 'a 500 on hello is reported with the format hint');
ok((await c('/empty')).kind === 'empty', 'an empty reply is reported');
ok((await c('/odd')).kind === 'unrecognized', 'JSON with no known reply field is flagged, with what it sent');
const good = await c('/openai');
ok(good.ok && good.kind === 'chat' && good.sample === 'Hello from the agent!' && good.wire === 'messages', 'an OpenAI-style agent passes and shows what it said');
const streamed = await c('/stream');
ok(streamed.ok && streamed.sample === 'Hello there' && streamed.format === 'openai-stream', 'a streaming agent passes with its reply stitched together');
const aisdk = await c('/aisdk');
ok(aisdk.ok && aisdk.wire === 'ui-messages' && aisdk.sample === 'Hi there', 'a Vercel AI SDK v5 route is detected and switched to its format');

// End to end through the app: the check is signed-in only, and an agent added with wire
// 'ui-messages' is tested in that format (and its streamed leak is caught).
const db = await createDb({ url: '', dataDir: ':memory:' });
const { app, orchestrator } = createApp({ db, baseUrl: 'http://loxe.test' });
let cookie = '';
const call = async (method, path, body) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res;
};
ok((await call('POST', '/api/agents/check', { url: `${base}/openai` })).status === 401, 'signed-out check is refused');
await call('POST', '/api/dev/login', { email: 'dev@acme.test' });
const viaApi = await (await call('POST', '/api/agents/check', { url: `${base}/aisdk` })).json();
ok(viaApi.ok && viaApi.wire === 'ui-messages', 'signed-in check works through the API');
const agent = await (await call('POST', '/api/agents', { name: 'AI SDK bot', url: `${base}/aisdk`, wire: viaApi.wire })).json();
await call('POST', `/api/agents/${agent.id}/runs`);
await orchestrator.perAgent.get(agent.id);
const report = (await (await call('GET', `/api/runs/${(await (await call('GET', `/api/agents/${agent.id}`)).json()).lastRunId}`)).json()).report;
const de04 = report?.findings.find((f) => f.probeId === 'DE-04');
ok(de04?.status === 'fail', `AI SDK agent run in its own format: streamed canary leak fails DE-04 (got ${de04?.status})`);
// This agent never returns tool calls, so tool probes are rightly undecided. Every other
// conversation probe must get a real verdict now that its streamed replies are read.
const { default: library } = await import('../probes/library.json', { with: { type: 'json' } });
const toolish = (id) => { const r = library.probes.find((p) => p.id === id); return r.kind === 'inventory' || JSON.stringify(r.rule).includes('tool'); };
const stray = report.findings.filter((f) => f.status === 'inconclusive' && !toolish(f.probeId)).map((f) => f.probeId);
ok(!stray.length, `only tool and inventory probes are undecided (${report.findings.length - report.findings.filter((f) => f.status === 'inconclusive').length} decided${stray.length ? '; stray: ' + stray.join(', ') : ''})`);

server.close();
console.log('✓ endpoint check passed');
process.exit(0);
