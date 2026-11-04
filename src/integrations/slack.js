// SLACK — a team pastes a Slack incoming-webhook URL; Loxe posts there when a grade changes,
// the ledger stops verifying, or (mode "every") after every finished run.
// The URL is a secret: it is sealed at rest, never returned to the browser (only its last 4
// characters), and only https://hooks.slack.com/services/... is accepted, so it cannot be
// pointed at anything else. Delivery failures are recorded and never break a run.
import { sealJson, openJson } from '../db/crypto.js';

const TIMEOUT_MS = 8000;
export const MODES = ['changes', 'every'];

export function validWebhook(raw) {
  let u;
  try {
    u = new URL(String(raw || '').trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' || u.hostname !== 'hooks.slack.com' || u.port || u.username || u.password) return null;
  if (!/^\/services\/[A-Za-z0-9]+\/[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(u.pathname) || u.search || u.hash) return null;
  return u.toString();
}

async function post(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    redirect: 'manual',
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = (await res.text().catch(() => '')).slice(0, 100);
  return { ok: res.status === 200, status: res.status, text };
}

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);

export function messageFor(ev) {
  const name = `*${esc(ev.agentName)}*`;
  const link = ev.url ? ` <${ev.url}|Open report>` : '';
  let text;
  if (ev.type === 'test') text = 'Loxe is connected. Alerts for this team will arrive here.';
  else if (ev.type === 'ledger_broken') text = `:warning: ${name}: the evidence ledger no longer verifies. Something changed a past record.${link}`;
  else if (ev.type === 'grade_change') text = `${gradeDown(ev.oldGrade, ev.newGrade) ? ':small_red_triangle_down:' : ':white_check_mark:'} ${name} went from grade ${esc(ev.oldGrade)} to ${esc(ev.newGrade)}. ${ev.failed} gaps open.${link}`;
  else if (ev.type === 'run_failed') text = `${name}: the test could not finish (${esc(ev.error)}).`;
  else text = `${name} tested: grade ${esc(ev.newGrade)}, ${ev.failed} gaps open.${link}`;
  return { text };
}

const gradeDown = (a, b) => a && b && b > a; // letters: 'C' > 'B' means worse

async function row(db, orgId) {
  return (await db.query(`select * from org_integrations where org_id = $1 and kind = 'slack'`, [orgId])).rows[0];
}

export async function connect(db, orgId, { url, mode }) {
  const clean = validWebhook(url);
  if (!clean) throw Object.assign(new Error('That is not a Slack webhook. It should start with https://hooks.slack.com/services/'), { status: 400 });
  const m = MODES.includes(mode) ? mode : 'changes';
  const test = await post(clean, messageFor({ type: 'test' })).catch((e) => ({ ok: false, status: 0, text: e.message }));
  if (!test.ok) throw Object.assign(new Error(`Slack refused the test message (${test.status || 'no answer'}). Check the webhook is still active.`), { status: 400 });
  const sealed = await sealJson(db, { url: clean });
  await db.query(
    `insert into org_integrations (org_id, kind, config, settings, last_status, last_at)
       values ($1, 'slack', $2, $3, 'delivered', now())
     on conflict (org_id, kind) do update set config = $2, settings = $3, last_status = 'delivered', last_at = now(), updated_at = now()`,
    [orgId, sealed, JSON.stringify({ mode: m, hint: clean.slice(-4) })]
  );
  return view(await row(db, orgId));
}

export async function setMode(db, orgId, mode) {
  if (!MODES.includes(mode)) throw Object.assign(new Error('mode must be changes or every'), { status: 400 });
  const r = await row(db, orgId);
  if (!r) throw Object.assign(new Error('Slack is not connected'), { status: 404 });
  const settings = { ...(typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings), mode };
  await db.query(`update org_integrations set settings = $2, updated_at = now() where org_id = $1 and kind = 'slack'`, [orgId, JSON.stringify(settings)]);
  return view({ ...r, settings });
}

export async function disconnect(db, orgId) {
  await db.query(`delete from org_integrations where org_id = $1 and kind = 'slack'`, [orgId]);
}

export function view(r) {
  if (!r) return { connected: false };
  const s = typeof r.settings === 'string' ? JSON.parse(r.settings) : r.settings || {};
  return { connected: true, mode: s.mode || 'changes', hint: s.hint || '', lastStatus: r.last_status, lastAt: r.last_at };
}

export async function status(db, orgId) {
  return view(await row(db, orgId));
}

// Send one event to the team's Slack, if connected and the mode wants it.
export async function send(db, orgId, ev) {
  const r = orgId && (await row(db, orgId));
  if (!r) return null;
  const { mode } = view(r);
  const important = ev.type !== 'run_completed';
  if (!important && mode !== 'every' && ev.type !== 'test') return null;
  let result;
  try {
    const { url } = await openJson(db, r.config);
    result = await post(url, messageFor(ev));
  } catch (e) {
    result = { ok: false, status: 0, text: e.message };
  }
  const st = result.ok ? 'delivered' : result.status === 404 || result.status === 410 ? 'webhook removed in Slack' : `failed (${result.status || 'no answer'})`;
  await db.query(`update org_integrations set last_status = $2, last_at = now() where org_id = $1 and kind = 'slack'`, [orgId, st]);
  return result;
}
