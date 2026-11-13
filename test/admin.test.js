// Owner stats: only owners see /admin and /api/admin/stats, owners are left out of the counts,
// and sign-ups, activity and the funnel reflect what users actually did.
import http from 'node:http';
import { createDb } from '../src/db/index.js';
import { createApp } from '../src/app/index.js';
import { demoFetch } from '../demo/target-agent.js';

process.env.LOXE_ALLOW_PRIVATE_TARGETS = '1';
process.env.LOXE_INTERNAL_SCHEDULER = '0';
process.env.LOXE_ADMIN_EMAILS = 'Owner@Loxe.test';
delete process.env.CLERK_SECRET_KEY;

const ok = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok', msg);
};

const target = http.createServer(async (req, res) => {
  let body = '';
  for await (const ch of req) body += ch;
  const r = await demoFetch(new Request(`http://x${req.url}`, { method: req.method, body: req.method === 'POST' ? body : undefined }));
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(await r.text());
});
await new Promise((r) => target.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${target.address().port}`;

const db = await createDb({ url: '', dataDir: ':memory:' });
const { app, orchestrator } = createApp({ db, baseUrl: 'http://loxe.test' });

function session() {
  let cookie = '';
  return async (method, path, body) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', origin: 'http://localhost', ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = res.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return res;
  };
}

const owner = session();
await owner('POST', '/api/dev/login', { email: 'owner@loxe.test' });
await owner('GET', '/api/me');

// Three real users: one only signs up, one adds an agent and runs it twice, one never comes back.
const tester = session();
await tester('POST', '/api/dev/login', { email: 'tester@acme.test' });
const agent = await (await tester('POST', '/api/agents', { name: 'Acme bot', url: `${base}/` })).json();
for (let i = 0; i < 2; i++) {
  await tester('POST', `/api/agents/${agent.id}/runs`);
  await orchestrator.perAgent.get(agent.id);
}
const lurker = session();
await lurker('POST', '/api/dev/login', { email: 'lurker@else.test' });
await lurker('GET', '/api/me');
const third = session();
await third('POST', '/api/dev/login', { email: 'third@else.test' });
await third('GET', '/api/me');
// The lurker signed up 10 days ago and has not been back since.
await db.query(`update users set created_at = now() - interval '10 days', last_seen_at = now() - interval '10 days' where email = 'lurker@else.test'`);

// Access control
const anon = await app.request('/admin');
ok(anon.status === 401 && (await anon.text()).includes('Sign in first'), 'signed-out /admin asks to sign in');
const notOwner = await tester('GET', '/admin');
ok(notOwner.status === 404, 'a non-owner gets 404 on /admin');
ok((await tester('GET', '/api/admin/stats')).status === 404, 'a non-owner gets 404 on /api/admin/stats');
ok((await app.request('/api/admin/stats')).status === 401, 'signed-out /api/admin/stats is 401');

// Numbers
const s = await (await owner('GET', '/api/admin/stats')).json();
ok(s.signups.total === 3, `owner is left out: 3 sign-ups (got ${s.signups.total})`);
ok(s.signups.last7 === 2 && s.signups.last30 === 3, `7-day and 30-day sign-ups are 2 and 3 (got ${s.signups.last7}, ${s.signups.last30})`);
ok(s.signups.active7 === 2, `2 active this week (got ${s.signups.active7})`);
ok(s.funnel.added_agent === 1 && s.funnel.ran_test === 1 && s.funnel.got_grade === 1 && s.funnel.ran_again === 1,
  `funnel: 1 added an agent, ran, got a grade, ran again (got ${JSON.stringify(s.funnel)})`);
ok(s.runs.total === 2, `2 tests counted, demo runs left out (got ${s.runs.total})`);
ok(s.daily.length === 30 && s.daily.at(-1).signups === 2, 'daily series has 30 days and today shows 2 sign-ups');
ok(s.goal.users === 1000 && s.goal.remaining === 997, 'goal tracks 997 to go');
const row = s.recent.find((u) => u.email === 'tester@acme.test');
ok(row && row.agents === 1 && row.runs === 2 && row.grades, 'latest sign-ups row shows agents, tests and grade');
ok(!s.recent.some((u) => u.email === 'owner@loxe.test'), 'owner is not listed in latest sign-ups');

const page = await owner('GET', '/admin');
const html = await page.text();
ok(page.status === 200 && html.includes('Sign-ups') && html.includes('tester@acme.test'), 'owner sees the stats page');
ok(page.headers.get('cache-control') === 'no-store', 'stats page is never cached');

// An agent name or email is attacker input: it must be escaped on the page.
await db.query(`update users set email = '<script>x</script>@evil.test' where email = 'third@else.test'`);
const html2 = await (await owner('GET', '/admin')).text();
ok(!html2.includes('<script>x</script>') && html2.includes('&lt;script&gt;'), 'emails are escaped on the stats page');

target.close();
console.log('✓ admin stats passed');
process.exit(0);
