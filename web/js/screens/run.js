// Live run: probes tick through the five categories. Polls GET /api/runs/:id every second.
import { api } from '../api.js';
import { html, raw, $, mark, seal, h1, when, CATEGORY_ORDER, CATEGORY_LABEL, CATEGORY_PREFIX, short, toast } from '../ui.js';
import { agentHeader, bindRunButtons, startRun } from './common.js';
import { PROBE, LIBRARY } from '../probes.js';
import { setContext, say } from '../owl.js';

// One line about the probe in flight, from the client copy of the battery. Falls back to the bare ID.
export function probeLine(id, version) {
  const p = PROBE[id];
  if (!p || (version && version !== LIBRARY.version && !PROBE[id])) return `Sending probe ${id}.`;
  return `Sending probe ${id}: ${p.checks.replace(/\.$/, '')}.`;
}

export async function render(main, ctx) {
  const runId = ctx.params[0];
  let run = await api.run(runId);
  const agent = await api.agent(run.agentId);
  if (!ctx.alive()) return;
  if (run.trigger === 'hand' && run.status === 'awaiting_replies') return (await import('./hand.js')).render(main, ctx, run, agent);

  const total = run.progress.total || 40;
  const per = Math.ceil(total / CATEGORY_ORDER.length);
  const laneDone = Object.fromEntries(CATEGORY_ORDER.map((c) => [c, 0]));
  const log = [];
  let lastDone = 0;
  let lastCat = CATEGORY_ORDER[0];
  const t0 = new Date(run.startedAt).getTime();
  let lastCtx = null;
  let announced = false;

  main.innerHTML = String(html`
    <section class="page">
      <div id="head">${agentHeader(agent, 'run', run)}</div>
      <div class="split split--70">
        <div>
          <div id="title"></div>
          <div class="panel" style="margin-top:var(--s5)">
            <div class="section-head"><h2 class="h3">Battery progress</h2><span class="small" id="count"></span></div>
            <div class="meter" style="margin:var(--s3) 0 var(--s5)"><span id="meter"></span></div>
            <div class="lanes" id="lanes"></div>
          </div>
          <div id="after" style="margin-top:var(--s5)"></div>
        </div>
        <aside class="side">
          <div class="panel">
            <h2 class="h3">This run</h2>
            <dl class="facts" style="margin-top:var(--s3)">
              <dt>Run</dt><dd class="mono">${run.id}</dd>
              <dt>Battery</dt><dd>${run.libraryVersion}</dd>
              <dt>Battery hash</dt><dd class="hash">${run.libraryHash}</dd>
              <dt>Started</dt><dd>${when(run.startedAt)}</dd>
              <dt>Elapsed</dt><dd id="elapsed">0s</dd>
            </dl>
          </div>
          <div class="panel">
            <h2 class="h3">Probe log</h2>
            <ol class="log" id="log" style="margin-top:var(--s3)" aria-live="off"></ol>
          </div>
        </aside>
      </div>
    </section>`);
  bindRunButtons(main, ctx.go);

  // The API reports done/total/current. Between polls several probes can finish, so done counts
  // are attributed lane by lane in battery order, each lane capped at its share of the battery.
  function observe(r) {
    const done = r.progress.done;
    const cur = r.progress.current;
    const curCat = cur ? CATEGORY_PREFIX[cur.split('-')[0]] || lastCat : lastCat;
    let delta = done - lastDone;
    if (lastDone === 0 && cur) lastCat = curCat;
    // Probes finished since the last poll belong to the lane that was running, up to its share;
    // anything beyond that belongs to the lane running now. Works whatever order the battery uses.
    const first = lastCat === curCat ? delta : Math.min(Math.max(0, per - laneDone[lastCat]), delta);
    laneDone[lastCat] += first;
    delta -= first;
    if (delta > 0) laneDone[curCat] += delta;
    if (cur && cur !== log[0]?.id) log.unshift({ t: Date.now(), id: cur, cat: curCat });
    lastCat = curCat;
    lastDone = done;
  }

  function paint(r) {
    const done = r.progress.done;
    const finished = r.status === 'completed';
    const title = $('#title', main);
    if (r.status === 'queued') title.innerHTML = String(html`${h1(`Queued for ${agent.name}.`)}<p class="lede liveline">Freezing the battery and hashing it, so this run records which probes it used. Probing starts in a second or two.</p>`);
    else if (r.status === 'running') title.innerHTML = String(html`${h1(`Probing ${agent.name}.`)}<p class="lede liveline" aria-live="polite">${r.progress.current ? probeLine(r.progress.current, r.libraryVersion) : 'Starting the first probe.'}</p><p class="hint">A fixed rule in code checks each reply, never a model. Each result is hashed into the ledger before the next probe goes out. You can leave; the run keeps going.</p>`);
    else if (r.status === 'failed') title.innerHTML = String(html`${h1('The run stopped.')}<p class="lede">${r.error || 'The run ended without a grade.'} No partial grade was written.</p>`);
    else title.innerHTML = String(html`${h1(`${agent.name} is graded ${r.grade}.`)}<p class="lede">${r.report ? `${r.report.passed} passed, ${r.report.failed} failed, ${r.report.inconclusive} inconclusive. The grade is set by the worst open failure.` : ''}</p>`);

    $('#count', main).textContent = `${done} of ${r.progress.total}`;
    $('#meter', main).style.setProperty('--p', String(done / (r.progress.total || 1)));
    $('#elapsed', main).textContent = `${Math.max(0, Math.round(((r.finishedAt ? new Date(r.finishedAt).getTime() : Date.now()) - t0) / 1000))}s`;

    const curCat = r.progress.current ? CATEGORY_PREFIX[r.progress.current.split('-')[0]] : null;
    const byCat = finished && r.report ? groupFindings(r.report.findings) : null;
    $('#lanes', main).innerHTML = String(html`${CATEGORY_ORDER.map((c) => {
      if (byCat) {
        const fs = byCat[c] || [];
        const pass = fs.filter((f) => f.status === 'pass').length;
        return html`<div class="lane"><div class="lane__name">${CATEGORY_LABEL[c]}</div><div class="lane__cells">${fs.map((f, i) => html`<span class="cell cell--${f.status}" style="animation:enter 260ms ${i * 25}ms both var(--ease-out)" title="${f.probeId} ${f.title}"></span>`)}</div><div class="lane__count">${pass} of ${fs.length}</div></div>`;
      }
      const d = laneDone[c];
      const active = c === curCat && r.status === 'running';
      const n = Math.max(per, d + (active ? 1 : 0));
      const cells = Array.from({ length: n }, (_, i) => (i < d ? 'done' : active && i === d ? 'current' : 'pending'));
      return html`<div class="lane ${active ? 'is-active' : ''}"><div class="lane__name">${CATEGORY_LABEL[c]}</div><div class="lane__cells">${cells.map((s) => html`<span class="cell cell--${s}"></span>`)}</div><div class="lane__count">${d} done</div></div>`;
    })}`);


    $('#log', main).innerHTML = String(html`${log.slice(0, 60).map((l) => html`<li><span>${new Date(l.t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })}</span><span>${l.id}</span><span>${CATEGORY_LABEL[l.cat]}</span></li>`)}${!log.length ? html`<li><span></span><span></span><span>Waiting for the first probe.</span></li>` : ''}`);

    if (r.progress.current && r.progress.current !== lastCtx) {
      lastCtx = r.progress.current;
      setContext({ route: 'runs', agentId: agent.id, runId: r.id, probeId: r.progress.current }, [`What is ${r.progress.current} testing?`, 'Why is no model deciding pass or fail?', 'What happens if the agent goes down mid-run?']);
    }
    const after = $('#after', main);
    if (finished && !announced) { announced = true; say(`Done. Graded ${r.grade}, all ${r.progress.total} results are in the ledger.`); }
    if (r.status === 'failed' && !announced) { announced = true; say('The run stopped. Nothing partial was graded.'); }
    if (finished) {
      after.innerHTML = String(html`<div class="row row--l"><a class="btn btn--primary" href="#/agents/${agent.id}/report?run=${r.id}" data-autofocus>Open the report card</a><a class="btn" href="#/agents/${agent.id}/ledger">Verify the ledger</a></div>`);
      $('[data-autofocus]', after)?.focus({ preventScroll: true });
      $('#head', main).innerHTML = String(agentHeader({ ...agent, grade: r.grade, lastRunAt: r.finishedAt }, 'run', r));
      bindRunButtons(main, ctx.go);
    } else if (r.status === 'failed') {
      after.innerHTML = String(html`<div class="state state--error"><div class="state__head">${mark('fail')}<b>What to check</b></div><p class="body">Make sure the endpoint is up and answers a plain POST. Then run again; the battery restarts from the first probe.</p><div class="row"><button class="btn btn--primary" id="again">Run it again</button><button class="btn btn--quiet" data-copy="${r.error || ''}" data-copy-label="Error copied">Copy error</button></div></div>`);
      $('#again', after).addEventListener('click', (e) => startRun(agent.id, ctx.go, e.currentTarget));
    } else after.innerHTML = '';
  }

  observe(run);
  paint(run);
  if (run.status === 'completed' || run.status === 'failed') return;

  let stopped = false;
  ctx.onLeave(() => { stopped = true; say(''); });
  let misses = 0;
  const poll = async () => {
    if (stopped) return;
    try {
      run = await api.run(runId);
      misses = 0;
    } catch (e) {
      if (e.status === 401) return;
      misses++;
      if (misses === 3) toast('Lost contact with the server. Still trying.', 'gap');
    }
    if (stopped || !ctx.alive()) return;
    observe(run);
    paint(run);
    if (run.status === 'queued' || run.status === 'running') setTimeout(poll, 1000);
  };
  setTimeout(poll, 1000);
}

function groupFindings(fs) {
  const g = {};
  fs.forEach((f) => { (g[f.category] ||= []).push(f); });
  return g;
}
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);
