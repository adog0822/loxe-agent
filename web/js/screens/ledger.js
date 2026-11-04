// Ledger trace. Recomputes each entry hash in the browser with SubtleCrypto and links it to the
// one before, then shows the server's own full-chain verdict from GET /verify/:agentId.
import { api, publicUrl, request } from '../api.js';
import { html, raw, $, $$, mark, h1, short, when, toast } from '../ui.js';
import { GENESIS, entryHash } from '../canonical.js';
import { agentHeader, bindRunButtons, loadAgent, loadReport } from './common.js';

export async function render(main, ctx) {
  const { agent, run } = await loadAgent(ctx.params[0]);
  const shown = await loadReport(agent, run);
  if (!ctx.alive()) return;
  const running = run && (run.status === 'queued' || run.status === 'running');

  // Entries: prefer a full ledger listing if the server offers one; otherwise use the evidence
  // references carried by the latest report (seq, payload hash, entry hash per probe).
  let entries = await request('GET', `/api/agents/${agent.id}/ledger`).then((r) => r?.entries || r).catch(() => null);
  let source = 'ledger';
  if (!Array.isArray(entries)) {
    source = 'report';
    entries = (shown?.report?.findings || []).map((f) => ({
      seq: f.auditor.evidence.ledgerSeq, payloadHash: f.auditor.evidence.hash, entryHash: f.auditor.evidence.entryHash, label: `${f.probeId} ${f.title}`, ts: f.auditor.evidence.ts,
    })).sort((a, b) => a.seq - b.seq);
  }
  entries.forEach((e, i) => {
    if (e.prevHash) return;
    if (e.seq === 0) e.prevHash = GENESIS;
    else if (i > 0 && entries[i - 1].seq === e.seq - 1) e.prevHash = entries[i - 1].entryHash;
  });

  main.innerHTML = String(html`
    <section class="page">
      ${agentHeader(agent, 'ledger', running ? run : null)}
      <div class="split split--70">
        <div>
          ${h1('Check the ledger yourself.')}
          <p class="lede">Your browser recomputes every entry hash from its position, the hash before it and the evidence hash. If anyone changed one byte, that entry and every one after it stops matching.</p>
          <div class="row row--l" style="margin-top:var(--s5)">
            <button class="btn btn--primary" id="go" ${raw(entries.length ? 'data-autofocus' : 'disabled')}>Verify the chain</button>
            <span class="small" id="status">${entries.length ? `${entries.length} entries ready to check.` : 'No entries yet. Run the battery once and the ledger fills up.'}</span>
          </div>
          ${entries.length ? html`
          <div class="panel" style="margin-top:var(--s5)">
            <div class="tracehead"><span style="text-align:right">Entry</span><span></span><span class="cols"><span>Previous hash</span><span>Evidence hash</span><span class="computed">Recomputed entry hash</span></span><span style="text-align:right">Result</span></div>
            <div class="tracebox"><ol class="trace" id="trace">${entries.map((e) => html`<li class="tr" data-seq="${e.seq}" title="${e.label || ''}">
              <span class="tr__seq">${e.seq}</span>
              <span class="tr__node"><span class="tr__dot"></span></span>
              <span class="tr__hashes"><span>${e.prevHash ? html`<b>${short(e.prevHash, 12)}</b>` : 'earlier run'}</span><span><b>${short(e.payloadHash, 12)}</b></span><span class="computed"><b>${'.'.repeat(12)}</b></span></span>
              <span class="tr__label">waiting</span>
            </li>`)}</ol></div>
          </div>` : ''}
        </div>
        <aside class="side side--sticky">
          <div id="verdict" class="verdict" aria-live="polite">
            <div class="verdict__head">${mark('pending')}<h2 class="h3">Not checked yet</h2></div>
            <p class="body">Press Verify. Your browser checks the entries shown here, and the server recomputes the whole chain from the first entry.</p>
          </div>
          <div class="panel">
            <h2 class="h3">How an entry hash is made</h2>
            <div class="formula">entryHash = sha256(canonical({
  agentId, seq, prevHash, payloadHash
}))</div>
            <p class="body small">Keys sorted, no whitespace. The first entry links to 64 zeros. The same function runs on the server and in this page.</p>
          </div>
          <div class="panel">
            <h2 class="h3">Check it without Loxe</h2>
            <p class="body">Anyone can call the public endpoint. No account needed.</p>
            <div class="copyfield"><input class="input" readonly value="${publicUrl.verify(agent.id)}" aria-label="Public verify URL"><button class="btn" data-copy="${publicUrl.verify(agent.id)}" data-copy-label="Verify URL copied">Copy</button></div>
          </div>
          ${source === 'report' && entries.length ? html`<p class="hint">This trace shows the ${entries.length} probe entries from the latest run. Decision entries and earlier runs are checked by the server only.</p>` : ''}
        </aside>
      </div>
    </section>`);
  bindRunButtons(main, ctx.go);

  const btn = $('#go', main);
  btn?.addEventListener('click', () => trace(main, ctx, agent, entries, btn));
  if (ctx.query.auto === '1' && btn) trace(main, ctx, agent, entries, btn);
}

async function trace(main, ctx, agent, entries, btn) {
  btn.disabled = true;
  btn.textContent = 'Verifying';
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const step = reduce ? 0 : Math.max(28, Math.min(90, 2400 / entries.length));
  const rows = $$('.tr', main);
  rows.forEach((r) => { r.className = 'tr'; r.querySelector('.tr__label').textContent = 'waiting'; r.querySelector('.computed b').textContent = '.'.repeat(12); });
  const status = $('#status', main);
  const verdict = $('#verdict', main);
  verdict.className = 'verdict';
  verdict.innerHTML = String(html`<div class="verdict__head"><span class="mark mark--running" aria-hidden="true"></span><h2 class="h3">Recomputing</h2></div><p class="body">Asking the server to check the full chain at the same time.</p>`);

  const server = api.verify(agent.id).catch((e) => ({ unreachable: e }));
  let firstBad = null;
  let prevComputed = null;
  for (let i = 0; i < entries.length; i++) {
    if (!ctx.alive()) return;
    const e = entries[i];
    const row = rows[i];
    row.classList.add('is-checking');
    const box = row.closest('.tracebox');
    if (box) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2);
    // The link: this entry's prevHash must equal the previous entry's stored hash.
    const prev = e.prevHash ?? null;
    const computed = await entryHash({ agentId: agent.id, seq: e.seq, prevHash: prev ?? '', payloadHash: e.payloadHash });
    if (!reduce) await typeIn(row.querySelector('.computed b'), short(computed, 12), step);
    else row.querySelector('.computed b').textContent = short(computed, 12);
    const linkOk = i === 0 || prevComputed === null || entries[i - 1].entryHash === prev;
    const ok = prev !== null && computed === e.entryHash && linkOk;
    row.classList.remove('is-checking');
    row.classList.add('is-done');
    const label = row.querySelector('.tr__label');
    if (prev === null) { row.classList.add('is-ok'); label.textContent = 'server checks'; }
    else if (firstBad !== null) { row.classList.add('is-after-bad'); label.textContent = ok ? 'unproven' : 'breaks'; }
    else if (ok) { row.classList.add('is-ok'); label.textContent = 'matches'; }
    else { firstBad = e.seq; row.classList.add('is-bad'); label.textContent = 'mismatch'; row.querySelector('.computed b').title = `stored ${e.entryHash}`; }
    prevComputed = computed;
    status.textContent = `Checked ${i + 1} of ${entries.length}.`;
    if (step) await sleep(step / 2);
  }
  const s = await server;
  if (!ctx.alive()) return;
  if (innerWidth < 981) requestAnimationFrame(() => verdict.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' }));
  btn.disabled = false;
  btn.textContent = 'Verify again';
  const head = entries.at(-1);
  if (s.unreachable) {
    verdict.className = 'verdict verdict--bad';
    verdict.innerHTML = String(html`<div class="verdict__head">${mark('stale')}<h2 class="h3">The server did not answer.</h2></div><p class="body">${s.unreachable.message}. Your browser's own check is above: ${firstBad === null ? 'every entry shown matched.' : `entry ${firstBad} did not match.`}</p>`);
    return;
  }
  if (s.valid && firstBad === null) {
    verdict.className = 'verdict verdict--ok';
    verdict.innerHTML = String(html`<div class="verdict__head">${mark('pass', { size: 'l' })}<h2 class="h3">Nobody has changed this evidence.</h2></div>
      <p class="body">Your browser matched ${entries.length} of ${entries.length} entries. The server recomputed all ${s.length} from the first entry and the chain holds.</p>
      <dl class="facts" style="margin-top:var(--s3)"><dt>Head</dt><dd class="hash">${s.head || head?.entryHash}</dd><dt>Checked</dt><dd>${when(new Date().toISOString())}</dd></dl>`);
    status.textContent = `All ${entries.length} entries match.`;
  } else {
    verdict.className = 'verdict verdict--bad';
    const where = firstBad ?? (s.error && s.error.match?.(/seq (\d+)/)?.[1]);
    verdict.innerHTML = String(html`<div class="verdict__head">${mark('broken', { size: 'l' })}<h2 class="h3">This evidence was changed after it was written.</h2></div>
      <p class="body">${firstBad !== null ? `Entry ${firstBad} does not match its recomputed hash, so every entry after it is unproven.` : 'Every entry shown here matched, but the server found a problem in an entry not shown.'} The server says: <code class="mono">${s.error || 'chain invalid'}</code>.</p>
      <p class="body">Loxe never edits ledger rows. Treat the report as untrusted until you know who changed entry ${where ?? '?'}.</p>`);
    status.textContent = firstBad !== null ? `Mismatch at entry ${firstBad}.` : 'Server reports a broken chain.';
    const badRow = firstBad !== null && $(`.tr[data-seq="${firstBad}"]`, main);
    if (badRow) { const box = badRow.closest('.tracebox'); box.scrollTop = Math.max(0, badRow.offsetTop - box.clientHeight / 2); }
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function typeIn(el, text, total) {
  const hex = '0123456789abcdef';
  const n = text.length;
  const frames = 4;
  for (let f = 0; f < frames; f++) {
    const keep = Math.floor((n * f) / frames);
    el.textContent = text.slice(0, keep) + Array.from({ length: n - keep }, () => hex[(Math.random() * 16) | 0]).join('');
    await sleep(total / frames / 2);
  }
  el.textContent = text;
}
