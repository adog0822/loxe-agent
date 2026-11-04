// Report card: grade, what it adheres to and does not, fixes by severity, evidence appendix.
// Each finding reads three ways: plain English, engineer, auditor.
import { api, publicUrl } from '../api.js';
import { html, raw, $, $$, esc, mark, seal, strip, stripFromFindings, findingState, h1, day, when, ago, short, toast, Word, word, plural, SEV_RANK, CATEGORY_ORDER, CATEGORY_LABEL, isStale } from '../ui.js';
import { agentHeader, bindRunButtons, loadAgent, loadReport, openFails } from './common.js';

const LANGS = [['plain', 'Plain English'], ['engineer', 'Engineer'], ['auditor', 'Auditor']];
const FW_NAME = { soc2: 'SOC 2', 'owasp-llm': 'OWASP LLM Top 10', 'nist-ai-rmf': 'NIST AI RMF', iso42001: 'ISO/IEC 42001' };
const DECISION = {
  open: 'Open',
  accepted_exception: 'Accepted as an exception',
  fix_proposed: 'Fix proposed',
  resolved: 'Marked resolved. The next run proves it or reopens it.',
};

let readAs = 'plain';
try { readAs = localStorage.getItem('loxe-readas') || 'plain'; } catch {}

export async function render(main, ctx) {
  const { agent, run } = await loadAgent(ctx.params[0]);
  const shown = await loadReport(agent, run, ctx.query.run);
  if (!ctx.alive()) return;
  const running = run && (run.status === 'queued' || run.status === 'running');

  if (!shown?.report) {
    main.innerHTML = String(html`<section class="page">
      ${agentHeader(agent, 'report', run)}
      <div class="empty">
        ${running ? html`${h1('The first run is still going.')}<p class="lede">The report card appears here the moment the last probe finishes.</p><div class="row" style="margin-top:var(--s5)"><a class="btn btn--primary" href="#/runs/${run.id}" data-autofocus>Watch the run</a></div>`
        : run?.status === 'failed' ? html`${h1('No report yet.')}<p class="lede">The last run stopped before it finished: ${run.error || 'no reason given'}. Run it again to get a grade.</p><div class="row" style="margin-top:var(--s5)"><button class="btn btn--primary" data-run-agent="${agent.id}" data-autofocus>Run clearance again</button></div>`
        : html`${h1('No report yet.')}<p class="lede">Run the battery once and the report card appears here: the grade, what ${agent.name} adheres to and what it does not, the fixes in order, and the evidence behind each one.</p><div class="row" style="margin-top:var(--s5)"><button class="btn btn--primary" data-run-agent="${agent.id}" data-autofocus>Run clearance now</button></div>`}
      </div>
    </section>`);
    bindRunButtons(main, ctx.go);
    return;
  }

  const rep = shown.report;
  const state = { rep, run: shown, agent };
  paintAll(main, ctx, state, running ? run : null);
}

function paintAll(main, ctx, state, liveRun) {
  const { rep, agent } = state;
  const fails = rep.findings.filter((f) => f.status === 'fail').sort(bySeverity);
  const inconclusive = rep.findings.filter((f) => f.status === 'inconclusive').sort(bySeverity);
  const passed = rep.findings.filter((f) => f.status === 'pass');
  const open = openFails(rep);
  const ctl = controlLedger(rep.findings);
  const stale = isStale(agent);

  main.innerHTML = String(html`
    <section class="page">
      ${agentHeader(agent, 'report', liveRun, { seal: false })}
      ${liveRun ? html`<div class="state"><div class="state__head"><span class="mark mark--running" aria-hidden="true"></span><b>A newer run is in progress.</b></div><p class="body">This card shows the run from ${ago(rep.ts)}. <a class="link" href="#/runs/${liveRun.id}">Watch the new one</a>.</p></div>` : ''}

      <header class="cover">
        ${seal(rep.grade, { size: 'l', stale })}
        <div>
          ${h1(open.length ? `${agent.name} has ${word(open.length)} open ${plural(open.length, 'gap')}.` : `${agent.name} cleared every probe it could.`)}
          <p class="lede">Graded ${rep.grade} because ${gradeReason(rep, open)}. ${rep.passed} of ${rep.total} probes passed${rep.inconclusive ? `, ${word(rep.inconclusive)} could not be decided` : ''}.</p>
          <p class="cover__claim">Cleared against these ${rep.total} probes in battery ${rep.libraryVersion} on ${day(rep.ts)}. This is a record of what the agent did on that date, verifiable by anyone at <a class="link" href="#/agents/${agent.id}/ledger">the ledger</a>. It is not a certification.${stale ? html` <span class="t-stale">It is more than a week old and sentinel is off.</span>` : ''}</p>
          <div class="row cover__actions">
            <a class="btn btn--primary" href="#/agents/${agent.id}/share" ${raw(open.length ? '' : 'data-autofocus')}>Share this clearance</a>
            <a class="btn" href="${publicUrl.pdf(rep.runId)}" target="_blank" rel="noopener">Download PDF</a>
            <a class="btn btn--quiet" href="#/agents/${agent.id}/ledger">Verify the ledger</a>
          </div>
        </div>
      </header>

      <div class="split split--70">
        <div>
          <div class="section-head">
            <div>
              <h2 class="h2">${open.length ? 'Fix these first' : fails.length ? 'Every gap has a decision' : 'No gaps found'}</h2>
              <p class="body">${fails.length ? 'Ordered by severity. Open one to read it in plain English, as an engineer or as an auditor.' : 'Nothing failed. The inconclusive probes below need a trace from the agent before Loxe can decide them.'}</p>
            </div>
            <div class="readas"><span class="small" id="readas-l">Read as</span>${segmented('global', readAs, 'readas-l')}</div>
          </div>
          ${fails.length ? html`<ol class="findings" style="margin-top:var(--s4)">${fails.map((f) => findingItem(f))}</ol>` : ''}
          ${inconclusive.length ? html`
            <h3 class="h3" style="margin-top:var(--s6)">Could not decide</h3>
            <p class="body">Loxe marks a probe inconclusive instead of guessing. These count as neither pass nor fail.</p>
            <ol class="findings" style="margin-top:var(--s3)">${inconclusive.map((f) => findingItem(f))}</ol>` : ''}
          <details class="more" style="margin-top:var(--s5)">
            <summary>Show the ${passed.length} probes that passed</summary>
            <ol class="findings" style="margin-top:var(--s2)">${passed.map((f) => findingItem(f))}</ol>
          </details>
        </div>

        <aside class="side">
          <div class="panel">
            <h2 class="h3">By category</h2>
            <div style="margin-top:var(--s3)">
            ${CATEGORY_ORDER.map((c) => {
              const k = rep.categories[c];
              if (!k) return '';
              const fs = rep.findings.filter((f) => f.category === c);
              return html`<div class="catrow"><span class="label">${k.label || CATEGORY_LABEL[c]}</span><span class="catrow__n">${k.passed} of ${k.total}</span>${strip(stripFromFindings(fs), { size: 's', label: `${k.label}: ${k.passed} passed, ${k.failed} failed, ${k.inconclusive} inconclusive` })}</div>`;
            })}
            </div>
          </div>

          <div class="panel">
            <h2 class="h3">Does not adhere to</h2>
            ${ctl.fail.length ? controlGroups(ctl.fail, 'fail') : html`<p class="body">${mark('pass', { size: 's' })} Every mapped control holds for these probes.</p>`}
          </div>

          <div class="panel">
            <h2 class="h3">Adheres to</h2>
            <p class="body small">Every probe mapped to these controls passed.</p>
            ${ctl.pass.length > 6
              ? html`${controlGroups(ctl.pass.slice(0, 6), 'pass')}<details class="more"><summary>${ctl.pass.length - 6} more</summary>${controlGroups(ctl.pass.slice(6), 'pass')}</details>`
              : controlGroups(ctl.pass, 'pass')}
            ${ctl.undecided.length ? html`<h3 class="label" style="margin-top:var(--s4)">Not yet determined</h3>${controlGroups(ctl.undecided, 'inconclusive')}` : ''}
          </div>

          <div class="panel">
            <h2 class="h3">Frameworks mapped</h2>
            <ul class="claim">${rep.frameworks.map((f) => html`<li><span></span><span><b>${f.name}</b> <span class="small">${f.version}</span></span></li>`)}</ul>
            <p class="hint" style="margin-top:var(--s2)">Mapping a probe to a control shows what the probe is evidence for. It does not mean the control is met in full.</p>
          </div>

          <div class="panel">
            <h2 class="h3">Ledger</h2>
            <dl class="facts" style="margin-top:var(--s3)">
              <dt>State</dt><dd>${rep.ledger.valid ? html`${mark('pass', { size: 's' })} Verified when this report was written` : html`${mark('broken', { size: 's' })} <span class="t-gap">Did not verify</span>`}</dd>
              <dt>Entries</dt><dd>${rep.ledger.length}</dd>
              <dt>Head</dt><dd class="hash">${rep.ledger.head}</dd>
              <dt>Battery</dt><dd class="hash">${rep.libraryHash}</dd>
            </dl>
            <a class="btn" style="margin-top:var(--s4)" href="#/agents/${agent.id}/ledger">Recompute it in your browser</a>
          </div>
        </aside>
      </div>

      <details class="more panel" id="appendix">
        <summary>Evidence appendix: ${rep.findings.length} ledger entries</summary>
        <p class="body">Each row is one probe result as written to the ledger. The payload hash covers the evidence; the entry hash binds it to its position and the entry before it.</p>
        <div class="tablewrap" style="margin-top:var(--s3)">
        <table class="appendix">
          <thead><tr><th>Seq</th><th>Probe</th><th>Result</th><th>Severity</th><th>Payload hash</th><th>Entry hash</th><th>Written</th></tr></thead>
          <tbody>${[...rep.findings].sort((a, b) => a.auditor.evidence.ledgerSeq - b.auditor.evidence.ledgerSeq).map((f) => html`<tr>
            <td class="mono">${f.auditor.evidence.ledgerSeq}</td>
            <td><span class="mono">${f.probeId}</span> ${f.title}</td>
            <td>${mark(findingState(f), { size: 's' })} ${f.status}</td>
            <td>${f.severity}</td>
            <td class="mono">${f.auditor.evidence.hash}</td>
            <td class="mono">${f.auditor.evidence.entryHash}</td>
            <td>${when(f.auditor.evidence.ts)}</td></tr>`)}</tbody>
        </table>
        </div>
      </details>
    </section>`);

  bindRunButtons(main, ctx.go);
  bind(main, ctx, state, liveRun);

  const focusId = ctx.query.finding;
  if (focusId && !state.focused) {
    state.focused = true;
    const li = main.querySelector(`.finding[data-probe="${CSS.escape(focusId)}"]`);
    if (li) {
      const d = li.closest('details'); if (d) d.open = true;
      toggle(li, true);
      li.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      li.classList.add('is-flash');
      li.querySelector('.finding__row')?.focus({ preventScroll: true });
    }
  }
}

function bind(main, ctx, state, liveRun) {
  $$('.finding__row', main).forEach((b) => b.addEventListener('click', () => toggle(b.closest('.finding'))));
  $$('.seg[data-seg] button', main).forEach((b) => b.addEventListener('click', () => {
    const seg = b.closest('.seg');
    const v = b.dataset.v;
    if (seg.dataset.seg === 'global') {
      readAs = v;
      try { localStorage.setItem('loxe-readas', v); } catch {}
      $$('.seg button', main).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
      $$('.finding', main).forEach((li) => setLang(li, v));
    } else {
      $$('button', seg).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      setLang(seg.closest('.finding'), v);
    }
  }));
  $$('[data-lookup]', main).forEach((b) => b.addEventListener('click', async () => {
    const out = b.parentElement.querySelector('.lookup');
    b.classList.add('is-busy');
    try {
      const r = await api.lookupHash(b.dataset.lookup);
      out.innerHTML = String(r.found
        ? html`${mark(r.chainValidAtEntry ? 'pass' : 'broken', { size: 's' })} Found at ledger entry ${r.seq}. ${r.chainValidAtEntry ? 'The chain verifies up to and including this entry.' : 'The chain is broken at or before this entry.'}`
        : html`${mark('fail', { size: 's' })} Not in any ledger. This hash was never written by Loxe.`);
    } catch (e) { out.textContent = `Lookup failed: ${e.message}`; }
    b.classList.remove('is-busy');
  }));
  $$('form[data-decide]', main).forEach((form) => {
    let chosen = null;
    $$('button[data-state]', form).forEach((b) => b.addEventListener('click', () => { chosen = b; }));
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const b = chosen || e.submitter;
      if (!b) return;
      const probeId = form.dataset.decide;
      b.classList.add('is-busy');
      $$('button', form).forEach((x) => { x.disabled = true; });
      try {
        const decision = await api.decide(state.rep.runId, probeId, b.dataset.state, form.note.value.trim());
        const f = state.rep.findings.find((x) => x.probeId === probeId);
        f.decision = decision;
        toast('Decision written to the ledger as its own entry.');
        const openIds = $$('.finding.is-open', main).map((x) => x.dataset.probe);
        const scroll = window.scrollY;
        paintAll(main, ctx, state, liveRun);
        openIds.forEach((id) => { const li = main.querySelector(`.finding[data-probe="${CSS.escape(id)}"]`); if (li) { const d = li.closest('details'); if (d) d.open = true; toggle(li, true); } });
        window.scrollTo(0, scroll);
      } catch (err) {
        toast(`Decision not saved: ${err.message}`, 'gap');
        b.classList.remove('is-busy');
        $$('button', form).forEach((x) => { x.disabled = false; });
      }
    });
  });
}

function toggle(li, force) {
  const on = force ?? !li.classList.contains('is-open');
  li.classList.toggle('is-open', on);
  li.querySelector('.finding__row').setAttribute('aria-expanded', String(on));
}

function setLang(li, v) {
  $$('.langpane', li).forEach((p) => { p.hidden = p.dataset.lang !== v; });
  $$('.seg[data-seg="one"] button', li).forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === v)));
}

function segmented(kind, value, labelledby) {
  return html`<span class="seg" data-seg="${kind}" role="group" ${raw(labelledby ? `aria-labelledby="${labelledby}"` : 'aria-label="Read this finding as"')}>${LANGS.map(([k, l]) => html`<button type="button" data-v="${k}" aria-pressed="${k === value}">${l}</button>`)}</span>`;
}

function findingItem(f) {
  const st = findingState(f);
  const e = f.engineer || {};
  const a = f.auditor || {};
  const ev = a.evidence || {};
  const id = `f-${f.probeId}`;
  return html`<li class="finding" data-probe="${f.probeId}">
    <button class="finding__row" type="button" aria-expanded="false" aria-controls="${id}">
      ${mark(st)}
      <span style="min-width:0"><span class="finding__title">${f.title}</span><span class="finding__plain">${f.plainEnglish}</span></span>
      <span class="finding__meta">${f.status !== 'pass' ? html`<span class="sev sev--${f.severity}">${cap(f.severity)}</span>` : ''}<span class="mono pid">${f.probeId}</span><span class="chev" aria-hidden="true"></span></span>
    </button>
    <div class="finding__body" id="${id}">
      ${f.decision && f.decision.state !== 'open' ? html`<div class="decision__state">${mark(f.decision.state, { size: 's' })}<span>${DECISION[f.decision.state]} by ${f.decision.by} ${ago(f.decision.at)}.${f.decision.note ? ` "${f.decision.note}"` : ''}</span></div>` : ''}
      <div class="lang"><span class="small">${CATEGORY_LABEL[f.category]}, ${f.severity} if it fails</span>${segmented('one', readAs)}</div>

      <div class="langpane" data-lang="plain" ${raw(readAs === 'plain' ? '' : 'hidden')}>
        ${a.controls?.[0] ? html`<h4>Why a buyer cares</h4><p>${a.controls[0].plain}</p>` : ''}
        ${e.remediation ? html`<h4>What to do</h4><p>${e.remediation.summary}</p>` : ''}
      </div>

      <div class="langpane" data-lang="engineer" ${raw(readAs === 'engineer' ? '' : 'hidden')}>
        <h4>Rule result</h4><pre class="raw">${e.reason || ''}</pre>
        ${e.detail ? html`<h4>Detail</h4><pre class="raw">${e.detail}</pre>` : ''}
        ${e.remediation ? html`<h4>Fix</h4><p>${e.remediation.summary}</p>${e.remediation.patch ? html`<pre class="raw">${e.remediation.patch}</pre><button class="btn btn--s btn--quiet" data-copy="${e.remediation.patch}" data-copy-label="Patch copied">Copy patch</button>` : ''}` : ''}
        ${e.replay ? html`<h4>Replay this probe</h4><pre class="raw">${e.replay}</pre><button class="btn btn--s btn--quiet" data-copy="${e.replay}" data-copy-label="Replay command copied">Copy command</button>` : ''}
      </div>

      <div class="langpane" data-lang="auditor" ${raw(readAs === 'auditor' ? '' : 'hidden')}>
        <h4>Controls this probe is evidence for</h4>
        <div style="margin-top:var(--s2)">${(a.controls || []).map((c) => html`<div class="ctrl"><span><b>${FW_NAME[c.framework] || c.framework}</b> <span class="mono">${c.id}</span></span><span>${c.title}. ${c.plain}</span></div>`)}</div>
        <h4>Evidence</h4>
        <dl class="facts" style="margin-top:var(--s2)">
          <dt>Payload hash</dt><dd class="hash">${ev.hash}</dd>
          <dt>Entry hash</dt><dd class="hash">${ev.entryHash}</dd>
          <dt>Ledger entry</dt><dd>${ev.ledgerSeq}</dd>
          <dt>Written</dt><dd>${when(ev.ts)}</dd>
        </dl>
        <div class="row" style="margin-top:var(--s3)"><button class="btn btn--s" data-lookup="${ev.hash}">Look up this hash</button><button class="btn btn--s btn--quiet" data-copy="${ev.hash}" data-copy-label="Hash copied">Copy hash</button><span class="small lookup" aria-live="polite"></span></div>
      </div>

      ${f.status === 'fail' ? decisionForm(f) : ''}
    </div>
  </li>`;
}

function decisionForm(f) {
  const cur = f.decision?.state || 'open';
  const opts = [['fix_proposed', 'Fix proposed'], ['accepted_exception', 'Accept as an exception'], ['resolved', 'Mark resolved']].filter(([k]) => k !== cur);
  if (cur !== 'open') opts.push(['open', 'Reopen']);
  return html`<form class="decision" data-decide="${f.probeId}">
    <h4 class="h3" style="font-size:var(--t-small)">Decide</h4>
    <p class="body small" style="margin-top:2px">Every decision is appended to the ledger with your name and time. Only a re-run turns this probe green.</p>
    <div class="field" style="margin-top:var(--s3)"><label class="label" for="n-${f.probeId}">Note for the record</label><textarea class="textarea" id="n-${f.probeId}" name="note" placeholder="Why, and who owns it"></textarea></div>
    <div class="row" style="margin-top:var(--s3)">${opts.map(([k, l], i) => html`<button class="btn btn--s ${i === 0 ? 'btn--primary' : ''}" type="submit" data-state="${k}">${l}</button>`)}</div>
  </form>`;
}

// Controls are judged by every probe mapped to them.
function controlLedger(findings) {
  const map = new Map();
  findings.forEach((f) => (f.auditor?.controls || []).forEach((c) => {
    const key = `${c.framework}|${c.id}`;
    if (!map.has(key)) map.set(key, { ...c, probes: [] });
    map.get(key).probes.push(f);
  }));
  const fail = [], pass = [], undecided = [];
  for (const c of map.values()) {
    if (c.probes.some((f) => f.status === 'fail')) fail.push(c);
    else if (c.probes.some((f) => f.status === 'inconclusive')) undecided.push(c);
    else pass.push(c);
  }
  const order = (a, b) => Object.keys(FW_NAME).indexOf(a.framework) - Object.keys(FW_NAME).indexOf(b.framework) || a.id.localeCompare(b.id, undefined, { numeric: true });
  return { fail: fail.sort(order), pass: pass.sort(order), undecided: undecided.sort(order) };
}

function controlGroups(list, state) {
  const groups = {};
  list.forEach((c) => { (groups[c.framework] ||= []).push(c); });
  return html`${Object.entries(groups).map(([fw, cs]) => html`<div class="fw"><div class="fw__name">${FW_NAME[fw] || fw}</div><ul class="ctlist">${cs.map((c) => {
    const failing = c.probes.filter((f) => f.status === 'fail');
    return html`<li>${mark(state, { size: 's' })}<span class="cid">${c.id}</span><span class="ctitle">${c.title}${failing.length ? html`<span class="small">, fails ${failing.map((f) => f.probeId).join(', ')}</span>` : ''}</span></li>`;
  })}</ul></div>`)}`;
}

function gradeReason(rep, open) {
  const s = rep.gradeSummary || '';
  if (rep.grade === 'A') return 'every probe that could be decided passed';
  if (/critical/.test(s)) return 'a critical finding is present';
  if (/high/.test(s)) return 'a high-severity finding is present';
  if (/medium/.test(s)) return 'the worst finding is medium severity';
  if (/low/.test(s)) return 'only low-severity findings remain';
  if (/\d+\/\d+/.test(s)) return `more than half the probes failed (${s.replace(' probes failed', '')})`;
  return s || 'of the findings below';
}

const bySeverity = (a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity] || a.probeId.localeCompare(b.probeId);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
