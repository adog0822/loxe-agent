// OWNER STATS (/admin, /api/admin/stats) — sign-ups and activity, for the people who run Loxe.
// Who counts as an owner: emails in LOXE_ADMIN_EMAILS (comma separated) or the `admin_emails`
// setting ({ "emails": [...] }). Owners are left out of every count so the numbers are real users.
// Activity that is not a person: the built-in demo agent and its org, demo and sentinel runs.
import { DEMO_AGENT } from '../demo/index.js';

export const GOAL = { users: 1000, by: '2026-12-11' };
const TZ = 'America/New_York';
const PERSON_RUN = `r.trigger is distinct from 'demo' and r.trigger is distinct from 'sentinel'`;

export async function adminEmails(db) {
  const env = (process.env.LOXE_ADMIN_EMAILS || '').split(',');
  const row = (await db.query(`select value from settings where key = 'admin_emails'`)).rows[0];
  const stored = row ? (typeof row.value === 'string' ? JSON.parse(row.value) : row.value).emails || [] : [];
  return [...new Set([...env, ...stored].map((e) => String(e).trim().toLowerCase()).filter(Boolean))];
}

export async function isAdmin(db, who) {
  const email = who?.user?.email?.toLowerCase();
  return !!email && (await adminEmails(db)).includes(email);
}

export async function stats(db, { now = new Date() } = {}) {
  const team = await adminEmails(db);
  const q = async (sql, params = []) => (await db.query(sql, [team, ...params])).rows;
  // $1 = owner emails. Real users are everyone else.
  const USERS = `select * from users where lower(coalesce(email, '')) <> all($1::text[])`;
  const RUNS = `select r.* from runs r where r.agent_id <> '${DEMO_AGENT}' and ${PERSON_RUN}`;

  const [totals] = await q(`
    with u as (${USERS})
    select count(*)::int as total,
      count(*) filter (where (created_at at time zone '${TZ}')::date = ($2::timestamptz at time zone '${TZ}')::date)::int as today,
      count(*) filter (where created_at > $2::timestamptz - interval '7 days')::int as last7,
      count(*) filter (where created_at > $2::timestamptz - interval '30 days')::int as last30,
      count(*) filter (where last_seen_at > $2::timestamptz - interval '1 day')::int as active1,
      count(*) filter (where last_seen_at > $2::timestamptz - interval '7 days')::int as active7,
      count(*) filter (where last_seen_at > $2::timestamptz - interval '30 days')::int as active30
    from u`, [now]);

  const [funnel] = await q(`
    with u as (${USERS}),
    a as (select org_id, count(*)::int n from agents where id <> '${DEMO_AGENT}' group by org_id),
    r as (select org_id, count(*)::int n, count(*) filter (where status = 'completed')::int done from (${RUNS}) r group by org_id)
    select count(*)::int as signed_up,
      count(*) filter (where a.n > 0)::int as added_agent,
      count(*) filter (where r.n > 0)::int as ran_test,
      count(*) filter (where r.done > 0)::int as got_grade,
      count(*) filter (where r.n > 1)::int as ran_again
    from u left join a on a.org_id = u.org_id left join r on r.org_id = u.org_id`);

  const daily = await q(`
    with days as (
      select generate_series(($2::timestamptz at time zone '${TZ}')::date - 29, ($2::timestamptz at time zone '${TZ}')::date, interval '1 day')::date as d
    )
    select to_char(days.d, 'YYYY-MM-DD') as day, count(u.id)::int as signups
    from days left join (${USERS}) u on (u.created_at at time zone '${TZ}')::date = days.d
    group by days.d order by days.d`, [now]);

  const [runs] = await q(`
    select count(*)::int as total,
      count(*) filter (where trigger = 'hand')::int as by_hand,
      count(*) filter (where started_at > $2::timestamptz - interval '7 days')::int as last7
    from (${RUNS}) r
    where r.org_id in (select org_id from (${USERS}) u)`, [now]);

  const recent = await q(`
    with u as (${USERS})
    select u.email, u.name, u.created_at, u.last_seen_at,
      (select count(*)::int from agents a where a.org_id = u.org_id and a.id <> '${DEMO_AGENT}') as agents,
      (select count(*)::int from (${RUNS}) r where r.org_id = u.org_id) as runs,
      (select string_agg(distinct a.current_grade, ' ') from agents a where a.org_id = u.org_id and a.id <> '${DEMO_AGENT}' and a.current_grade is not null) as grades
    from u order by u.created_at desc limit 50`);

  const daysLeft = Math.max(0, Math.ceil((Date.parse(`${GOAL.by}T23:59:59-05:00`) - now.getTime()) / 86_400_000));
  const remaining = Math.max(0, GOAL.users - totals.total);
  return {
    generatedAt: now.toISOString(),
    signups: totals,
    goal: { ...GOAL, remaining, daysLeft, perDayNeeded: daysLeft ? Math.ceil(remaining / daysLeft) : remaining },
    funnel,
    runs,
    daily,
    recent,
    excludedOwners: team.length,
  };
}

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const when = (d) => {
  if (!d) return '–';
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};

const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);

export function statsPage(s) {
  const { signups: t, goal: g, funnel: f, daily, recent, runs } = s;
  const max = Math.max(1, ...daily.map((d) => d.signups));
  const W = 600, H = 120, bw = W / daily.length;
  const bars = daily.map((d, i) => {
    const h = d.signups ? Math.max(3, (d.signups / max) * (H - 18)) : 0;
    return `<rect x="${(i * bw + 1).toFixed(1)}" y="${(H - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="1"><title>${esc(d.day)}: ${d.signups} sign-up${d.signups === 1 ? '' : 's'}</title></rect>`;
  }).join('');
  const steps = [
    ['Signed up', f.signed_up],
    ['Added an agent', f.added_agent],
    ['Ran a test', f.ran_test],
    ['Got a grade', f.got_grade],
    ['Ran 2+ tests', f.ran_again],
  ];
  const progress = Math.min(100, pct(t.total, g.users));

  const body = `<main>
  <p class="who">Loxe owner stats · updated ${esc(new Date(s.generatedAt).toLocaleString('en-US', { timeZone: TZ, dateStyle: 'medium', timeStyle: 'short' }))} ET</p>
  <section class="hero">
    <div><p class="label">Sign-ups</p><p class="big">${t.total.toLocaleString()}</p></div>
    <div class="goal">
      <p class="label">Goal: ${g.users.toLocaleString()} by Dec 11</p>
      <div class="track" role="img" aria-label="${progress}% of goal"><div class="fill" style="width:${progress}%"></div></div>
      <p class="sub">${g.remaining.toLocaleString()} to go · ${g.daysLeft} days left · ${g.perDayNeeded.toLocaleString()} a day needed</p>
    </div>
  </section>
  <section class="tiles">
    <div><p class="label">Today</p><p class="n">${t.today}</p></div>
    <div><p class="label">Last 7 days</p><p class="n">${t.last7}</p></div>
    <div><p class="label">Last 30 days</p><p class="n">${t.last30}</p></div>
    <div><p class="label">Active, last 24 h</p><p class="n">${t.active1}</p></div>
    <div><p class="label">Active, last 7 days</p><p class="n">${t.active7}</p></div>
    <div><p class="label">Tests run, 7 days</p><p class="n">${runs.last7}</p></div>
  </section>
  <section>
    <h2>Sign-ups per day, last 30 days</h2>
    <svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Daily sign-ups"><line x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}" class="base"/>${bars}</svg>
    <p class="axis"><span>${esc(daily[0]?.day)}</span><span>today</span></p>
  </section>
  <section>
    <h2>Where people drop off</h2>
    <ul class="funnel">${steps.map(([label, n]) => `<li><span class="fl">${label}</span><span class="fb"><span style="width:${pct(n, f.signed_up)}%"></span></span><span class="fn">${n}</span><span class="fp">${f.signed_up ? `${pct(n, f.signed_up)}%` : ''}</span></li>`).join('')}</ul>
  </section>
  <section>
    <h2>Latest sign-ups</h2>
    <div class="scroll"><table>
      <thead><tr><th>Email</th><th>Signed up</th><th>Last active</th><th class="r">Agents</th><th class="r">Tests</th><th>Grades</th></tr></thead>
      <tbody>${recent.map((u) => `<tr><td>${esc(u.email)}${u.name && u.name !== u.email ? `<span class="nm">${esc(u.name)}</span>` : ''}</td><td>${esc(when(u.created_at))}</td><td>${esc(when(u.last_seen_at))}</td><td class="r">${u.agents}</td><td class="r">${u.runs}</td><td>${esc(u.grades || '–')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No sign-ups yet.</td></tr>'}</tbody>
    </table></div>
  </section>
  <p class="disc">Counts leave out ${s.excludedOwners} owner account${s.excludedOwners === 1 ? '' : 's'}, the built-in demo agent, and scheduled re-tests. "Active" means signed in and used the app. Totals start Nov 12, 2026, when data moved to Supabase. JSON at <a href="/api/admin/stats">/api/admin/stats</a>.</p>
</main>`;
  return shell('Owner stats', body);
}

export function adminGate(kind) {
  const body = kind === 'signin'
    ? `<main><h1>Sign in first</h1><p class="sub">Your session has expired or you are signed out. <a href="/app/">Open Loxe</a>, sign in, then come back to this page.</p></main>`
    : `<main><h1>Not found</h1></main>`;
  return shell(kind === 'signin' ? 'Sign in' : 'Not found', body);
}

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)} | Loxe</title>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,700&family=Geist:wght@400;500;600&family=Geist+Mono&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f8f7;--ink:#0d1412;--mute:#5b6763;--line:#d9e0dd;--accent:#0f9d6b;--soft:#e4ece8}
@media (prefers-color-scheme:dark){:root{--bg:#0b100f;--ink:#eef3f1;--mute:#93a19c;--line:#24302c;--accent:#2fd39b;--soft:#16201d}}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.5 Geist,system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:40px 16px 64px}a{color:var(--ink)}
h1{font:500 32px/1.15 'Bodoni Moda',serif;margin-bottom:8px}h2{font-size:15px;font-weight:600;margin:40px 0 12px}
.who,.label,.sub,.axis,.disc,.nm{color:var(--mute)}.who{margin-bottom:24px;font-size:13px}.label{font-size:13px}
.hero{display:grid;grid-template-columns:auto 1fr;gap:16px 48px;align-items:end;padding-bottom:28px;border-bottom:1px solid var(--line)}
.big{font:600 88px/1 Geist,system-ui,sans-serif;letter-spacing:-0.03em;font-variant-numeric:tabular-nums}
.track{height:10px;background:var(--soft);border-radius:5px;overflow:hidden;margin:8px 0}.fill{height:100%;background:var(--accent);min-width:2px}
.tiles{display:grid;grid-template-columns:repeat(6,1fr);border-bottom:1px solid var(--line)}
.tiles div{padding:16px 12px 16px 0}.n{font:600 26px/1.2 Geist,sans-serif;font-variant-numeric:tabular-nums}
.chart{width:100%;height:120px;display:block;fill:var(--accent)}.chart .base{stroke:var(--line);stroke-width:1}.axis{display:flex;justify-content:space-between;font-size:12px;margin-top:4px}
.funnel{list-style:none;padding:0}.funnel li{display:grid;grid-template-columns:140px 1fr 48px 44px;gap:12px;align-items:center;padding:6px 0}
.fb{height:8px;background:var(--soft);border-radius:4px;overflow:hidden}.fb span{display:block;height:100%;background:var(--accent)}
.fn{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}.fp{color:var(--mute);font-size:13px;text-align:right}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:14px}th{text-align:left;font-weight:500;color:var(--mute);font-size:13px;padding:8px 12px 8px 0;border-bottom:1px solid var(--line)}
td{padding:10px 12px 10px 0;border-bottom:1px solid var(--line);white-space:nowrap}.r{text-align:right;font-variant-numeric:tabular-nums}
.nm{display:block;font-size:12px}.empty{color:var(--mute)}.disc{margin-top:40px;font-size:13px;max-width:70ch}
@media(max-width:700px){.hero{grid-template-columns:1fr}.big{font-size:72px}.tiles{grid-template-columns:repeat(3,1fr)}.funnel li{grid-template-columns:110px 1fr 36px 40px}}
</style></head><body>${body}</body></html>`;
}
