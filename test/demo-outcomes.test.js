// Expected outcomes: clears the demo agent twice, once careless (POST /) and once hardened
// (POST /secure), and checks every probe's verdict against docs/expected-outcomes.json.
// The careless run shows the probes catch real failures; the hardened run shows they do not
// flag safe replies (false positives). `node test/demo-outcomes.test.js --update` rewrites
// the file and docs/EXPECTED.md after an intended probe or demo change.
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { createDb } from '../src/db/index.js';
import { createApp } from '../src/app/index.js';
import { demoFetch } from '../demo/target-agent.js';

process.env.LOXE_ALLOW_PRIVATE_TARGETS = '1';
process.env.LOXE_INTERNAL_SCHEDULER = '0';
delete process.env.CLERK_SECRET_KEY;

const FIXTURE = new URL('../docs/expected-outcomes.json', import.meta.url);
const TABLE = new URL('../docs/EXPECTED.md', import.meta.url);
const update = process.argv.includes('--update');

const ok = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok', msg);
};

// Serve the demo agent over real HTTP so the collector's timing and rate-limit probes see a socket.
const target = http.createServer(async (req, res) => {
  let body = '';
  for await (const c of req) body += c;
  const r = await demoFetch(new Request(`http://x${req.url}`, { method: req.method, body: req.method === 'POST' ? body : undefined }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(await r.text());
});
await new Promise((r) => target.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${target.address().port}`;

const db = await createDb({ dataDir: ':memory:' });
const { app, orchestrator } = createApp({ db, baseUrl: 'http://loxe.test' });
let cookie = '';
const call = async (method, path, body) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const sc = res.headers.get('set-cookie');
  if (sc) cookie = sc.split(';')[0];
  return res.json();
};
await call('POST', '/api/dev/login', { email: 'founder@loxe.ai' });

// Careless first: its shared-notes bug depends on a planted code from earlier in the same process.
async function clear(name, url) {
  const agent = await call('POST', '/api/agents', { name, url });
  const q = await call('POST', `/api/agents/${agent.id}/runs`);
  await orchestrator.perAgent.get(agent.id);
  const run = await call('GET', `/api/runs/${q.runId}`);
  const r = run.report;
  return {
    grade: r.grade,
    verdicts: Object.fromEntries([...r.findings].sort((a, b) => a.probeId.localeCompare(b.probeId)).map((f) => [f.probeId, f.status])),
    titles: Object.fromEntries(r.findings.map((f) => [f.probeId, f.title])),
  };
}
const careless = await clear('HelixDesk careless', `${base}/`);
const secure = await clear('HelixDesk hardened', `${base}/secure`);
target.close();

const now = {
  note: 'Verdicts Loxe gives the demo agent in demo/target-agent.js. careless = POST /, hardened = POST /secure. Regenerate with: node test/demo-outcomes.test.js --update',
  careless: { grade: careless.grade, verdicts: careless.verdicts },
  hardened: { grade: secure.grade, verdicts: secure.verdicts },
};

if (update) {
  writeFileSync(FIXTURE, JSON.stringify(now, null, 2) + '\n');
  const ids = Object.keys(careless.verdicts);
  const count = (v, s) => Object.values(v).filter((x) => x === s).length;
  const rows = ids.map((id) => `| ${id} | ${careless.titles[id]} | ${careless.verdicts[id]} | ${secure.verdicts[id]} |`);
  writeFileSync(TABLE, `# Expected outcomes

The demo agent in [\`demo/target-agent.js\`](../demo/target-agent.js) has two brains with no model behind them, so every run gives the same verdicts:

- **Careless** (\`POST /\`) makes the mistakes real agents make. It shows the probes catch failures.
- **Hardened** (\`POST /secure\`) answers the same messages safely. It shows the probes do not flag safe replies.

\`npm test\` clears both and fails if any verdict differs from [\`expected-outcomes.json\`](expected-outcomes.json). Run either yourself with \`npm run demo\` and add \`http://localhost:4100/\` or \`http://localhost:4100/secure\` as an agent.

| | Careless | Hardened |
|---|---|---|
| Grade | ${careless.grade} | ${secure.grade} |
| Pass | ${count(careless.verdicts, 'pass')} | ${count(secure.verdicts, 'pass')} |
| Fail | ${count(careless.verdicts, 'fail')} | ${count(secure.verdicts, 'fail')} |
| Inconclusive | ${count(careless.verdicts, 'inconclusive')} | ${count(secure.verdicts, 'inconclusive')} |

The hardened brain's one fail is ${Object.keys(secure.verdicts).filter((id) => secure.verdicts[id] === 'fail').join(', ') || 'none'}: locally it is served over plain HTTP, which the HTTPS probe correctly flags as high severity, and that alone caps the grade at D. It is a real finding about the setup, not a false positive on a reply.

A grade only covers these probes. Passing all 40 means the agent held against these attacks on that date, not that it is safe against attacks the battery does not contain.

| Probe | Title | Careless | Hardened |
|---|---|---|---|
${rows.join('\n')}
`);
  console.log(`  wrote docs/expected-outcomes.json and docs/EXPECTED.md (careless ${careless.grade}, hardened ${secure.grade})`);
  process.exit(0);
}

const want = JSON.parse(readFileSync(FIXTURE, 'utf8'));
for (const mode of ['careless', 'hardened']) {
  const diff = Object.keys({ ...want[mode].verdicts, ...now[mode].verdicts })
    .filter((id) => want[mode].verdicts[id] !== now[mode].verdicts[id])
    .map((id) => `${id}: expected ${want[mode].verdicts[id]}, got ${now[mode].verdicts[id]}`);
  ok(!diff.length, `${mode} demo agent: every verdict matches expected-outcomes.json${diff.length ? `\n    ${diff.join('\n    ')}` : ''}`);
  ok(want[mode].grade === now[mode].grade, `${mode} demo agent grades ${now[mode].grade} (expected ${want[mode].grade})`);
}
process.exit(0);
