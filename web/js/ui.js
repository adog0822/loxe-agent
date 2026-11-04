// Small rendering kit: escaped templates, state marks, grade seals, probe strips, time, copy.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);

export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (v instanceof Raw) out += v.s;
    else if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.s : esc(x))).join('');
    else if (v === false || v === null || v === undefined) out += '';
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// ---------- words and numbers ----------
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
export const word = (n) => (n >= 0 && n < 10 ? WORDS[n] : String(n));
export const Word = (n) => { const w = word(n); return w[0].toUpperCase() + w.slice(1); };
export const plural = (n, one, many = one + 's') => (n === 1 ? one : many);

export const SEV_RANK = { critical: 4, high: 3, medium: 2, low: 1 };
export const CATEGORY_ORDER = ['data_exposure', 'tool_permissions', 'injection_resistance', 'harmful_action_refusal', 'operational_hygiene'];
export const CATEGORY_LABEL = {
  data_exposure: 'Data exposure',
  tool_permissions: 'Tool permissions',
  injection_resistance: 'Injection resistance',
  harmful_action_refusal: 'Harmful-action refusal',
  operational_hygiene: 'Operational hygiene',
};
export const CATEGORY_PREFIX = { DE: 'data_exposure', TP: 'tool_permissions', IR: 'injection_resistance', HA: 'harmful_action_refusal', OH: 'operational_hygiene' };

// ---------- time ----------
export function ago(isoStr) {
  if (!isoStr) return 'never';
  const s = Math.round((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 0) return until(isoStr);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ${plural(h, 'hour')} ago`;
  const d = Math.round(h / 24);
  return `${d} ${plural(d, 'day')} ago`;
}
export function until(isoStr) {
  if (!isoStr) return 'not scheduled';
  const s = Math.round((new Date(isoStr).getTime() - Date.now()) / 1000);
  if (s <= 60) return 'in under a minute';
  const m = Math.round(s / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `in ${h} ${plural(h, 'hour')}`;
  return `in ${Math.round(h / 24)} days`;
}
export function when(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  return d.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function day(isoStr) {
  if (!isoStr) return '';
  return new Date(isoStr).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
}
export const isStale = (agent) => !!agent.lastRunAt && Date.now() - new Date(agent.lastRunAt).getTime() > 7 * 864e5 && !agent.sentinel?.enabled;

export const short = (h, n = 10) => (h ? `${h.slice(0, n)}` : '');

// ---------- state marks ----------
const MARK_LABEL = {
  pass: 'Passed', fail: 'Failed', inconclusive: 'Inconclusive', pending: 'Not run yet', running: 'Running',
  accepted_exception: 'Accepted as an exception', fix_proposed: 'Fix proposed', resolved: 'Marked resolved, awaiting re-run',
  stale: 'Stale', ok: 'Working', off: 'Not configured', broken: 'Broken',
};
export function mark(state, { size = 'm', label = true } = {}) {
  const l = MARK_LABEL[state] || state;
  return html`<span class="mark mark--${state} mark--${size}" ${raw(label ? `role="img" aria-label="${esc(l)}"` : 'aria-hidden="true"')}></span>`;
}
// A finding's mark accounts for the decision taken on it.
export function findingState(f) {
  if (f.status === 'fail' && f.decision && f.decision.state !== 'open') return f.decision.state;
  return f.status;
}

// ---------- grade seal ----------
export function seal(grade, { size = 'm', stale = false, running = false } = {}) {
  const tone = !grade ? 'none' : grade === 'A' ? 'proven' : grade === 'B' || grade === 'C' ? 'mixed' : 'gap';
  const label = !grade ? 'Not graded yet' : `Grade ${grade}${stale ? ', stale' : ''}`;
  return html`<span class="seal seal--${size} seal--${tone} ${stale ? 'seal--stale' : ''} ${running ? 'seal--running' : ''}" role="img" aria-label="${label}"><span class="seal__letter">${grade || ''}</span></span>`;
}

// ---------- probe strip ----------
// cells: [{category, state}] in battery order. Grouped by category with a gap between groups.
export function strip(cells, { size = 'm', label = 'Probe results' } = {}) {
  const groups = CATEGORY_ORDER.map((c) => cells.filter((x) => x.category === c)).filter((g) => g.length);
  return html`<span class="strip strip--${size}" role="img" aria-label="${label}">${groups.map((g) => html`<span class="strip__group">${g.map((c) => html`<span class="cell cell--${c.state}"></span>`)}</span>`)}</span>`;
}
export function stripFromFindings(findings) {
  return [...findings]
    .sort((a, b) => CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category))
    .map((f) => ({ category: f.category, state: findingState(f) }));
}

// ---------- headings ----------
// Lesson from the console lab: the Didone is for word-only H1s. A headline with a digit sets in the sans.
export function h1(text, cls = '') {
  return html`<h1 class="${/\d/.test(text) ? 'h1 h1--num' : 'h1'} ${cls}">${text}</h1>`;
}

// ---------- feedback ----------
let toastTimer;
export function toast(msg, tone = 'neutral') {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    document.body.append(el);
  }
  el.className = `toast toast--${tone} is-on`;
  el.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-on'), 2600);
}

export async function copy(text, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what}.`);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.append(ta);
    ta.select();
    try { document.execCommand('copy'); toast(`${what}.`); } catch { toast('Copy failed. Select the text and copy it by hand.', 'gap'); }
    ta.remove();
  }
}

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-copy]');
  if (b) { e.preventDefault(); copy(b.dataset.copy, b.dataset.copyLabel || 'Copied'); }
});

// ---------- states ----------
export function skeleton(lines = 3, cls = '') {
  return html`<div class="skeleton ${cls}" aria-hidden="true">${Array.from({ length: lines }, (_, i) => html`<span class="skeleton__line" style="width:${[92, 74, 58, 81, 66][i % 5]}%"></span>`)}</div>`;
}

export function errorBlock(err, { title = 'Loxe could not load this.', retry = true } = {}) {
  const detail = err?.status ? `${err.status} on ${err.path || 'request'}: ${err.message}` : String(err?.message || err);
  return html`<div class="state state--error" role="alert">
    <div class="state__head">${mark('fail')}<h2 class="h2">${title}</h2></div>
    <p class="body">${err?.status === 0 ? err.message : 'The server answered with an error. Nothing you entered was lost.'}</p>
    <pre class="mono raw">${detail}</pre>
    <div class="row">${retry ? html`<button class="btn" data-action="retry">Try again</button>` : ''}<button class="btn btn--quiet" data-copy="${detail}" data-copy-label="Error details copied">Copy error details</button></div>
  </div>`;
}

// Server detail strings may lack a full stop. Add one so they sit inside our sentences.
export const sentence = (s) => { const t = String(s ?? '').trim(); return !t ? '' : /[.!?]$/.test(t) ? t : `${t}.`; };
