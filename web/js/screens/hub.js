// Hub: one hero tile holding the next move, a ranked rail, the roster, integration status.
import { api } from '../api.js';
import { html, raw, $, $$, seal, strip, stripFromFindings, mark, ago, until, isStale, skeleton, Word, word, plural, h1, CATEGORY_ORDER, CATEGORY_PREFIX } from '../ui.js';
import { attention, startRun } from './common.js';
import { firstAgentForm, bindFirstAgent } from './first-agent.js';
import { getPrefs, orderFrameworks, alertLabel } from '../prefs.js';
import { setContext } from '../owl.js';

const FW = { soc2: 'SOC 2', 'owasp-llm': 'OWASP', 'nist-ai-rmf': 'NIST AI RMF', iso42001: 'ISO 42001' };

let arrivedOnce = false;

export async function render(main, ctx) {
  main.innerHTML = String(html`
    <section class="page" aria-busy="true">
      <div class="split split--hub">
        <div class="hero">${skeleton(1)}<div>${skeleton(3)}</div><p class="hero__why">Loading your agents and their latest runs.</p></div>
        <div class="rail"><div class="h3">Next up</div>${skeleton(4, 'skeleton--tall')}</div>
      </div>
    </section>`);

  const [agents, ints] = await Promise.all([api.agents(), api.integrations().catch((e) => ({ error: e }))]);
  const runs = await Promise.all(agents.map((a) => (a.lastRunId ? api.run(a.lastRunId).catch(() => null) : null)));
  if (!ctx.alive()) return;

  const prefs = getPrefs(ctx.session.user?.id) || {};
  if (!agents.length) {
    main.innerHTML = String(html`
      <section class="page">
        <div class="split split--hub">
          <div class="hero hero--form">
            ${firstAgentForm(prefs)}
          </div>
          <div class="rail">
            <h2 class="h3">What happens when you click</h2>
            <ol class="rail__list">
              ${[['Attack', 'Loxe sends your agent 40 tests: leaking data, misusing tools, obeying hidden instructions, doing harm.'], ['Grade', 'Each reply is checked by code, not by an AI, and the agent gets a grade from A to F.'], ['Prove', 'You get a report and a link anyone can open to check the results are real.']].map(([t, d], i) => html`<li class="rail__item"><span class="rank">${i + 1}</span><div><div class="rail__name">${t}</div><p class="rail__why">${d}</p></div><span></span></li>`)}
            </ol>
            <p class="hint">Want to see it first? Switch on <b>Demo</b> in the top bar.</p>
          </div>
        </div>
      </section>`);
    bindFirstAgent(main, ctx);
    return;
  }

  const ranked = agents.map((a, i) => attention(a, runs[i])).sort((x, y) => y.score - x.score);
  const hero = ranked[0];
  const allClear = hero.score === 0;
  const rail = ranked.slice(1).filter((x) => x.score > 0).slice(0, 4);
  // The welcome answers add setup moves to the rail, and pick which framework the hero quotes.
  const fw = orderFrameworks(Object.keys(FW), prefs)[0];
  if (hero.finding) {
    const c = hero.finding.auditor?.controls?.find((x) => x.framework === fw);
    if (c) hero.rule = `${hero.rule} Fails ${FW[fw]} ${c.id}, ${c.title.charAt(0).toLowerCase() + c.title.slice(1)}.`;
  }
  const setup = [];
  if (prefs.alerts && prefs.alerts !== 'none' && ints?.keiki && !ints.keiki.configured) setup.push({ mark: 'off', name: `Alerts on ${alertLabel(prefs.alerts)}`, why: 'Keiki is not configured, so nobody hears when a grade drops.', href: '#/integrations', verb: 'Set up' });
  if (prefs.where === 'maritime' && !agents.some((a) => a.source === 'maritime')) setup.push({ mark: 'pending', name: 'Your Maritime agents', why: 'None cleared yet. One click each.', href: '#/connect?to=maritime', verb: 'Pick' });
  if (prefs.where === 'keiki') setup.push({ mark: 'pending', name: 'Clear from Keiki', why: 'Text clear and a URL to the Loxe agent.', href: '#/connect?to=keiki', verb: 'How' });
  setContext({ route: 'hub', agentId: hero.agent.id, runId: hero.run?.id }, ['What should I do first?', 'How is this list ranked?', 'What does a grade mean?']);
  const runningCount = ranked.filter((x) => x.state === 'running').length;
  const needCount = ranked.filter((x) => x.score >= 30).length;

  main.innerHTML = String(html`
    <section class="page">
      ${ctx.query.first ? html`<section class="firstbox"><h2 class="h2">Test one of your own agents.</h2>${firstAgentForm(prefs, { compact: true })}</section>` : ''}
      <div class="split split--hub">
        ${allClear ? heroAllClear(agents) : heroTile(hero, needCount)}
        <div class="rail">
          <div class="section-head"><h2 class="h3">Next up</h2><span class="small">Ranked by what needs you</span></div>
          ${rail.length || setup.length ? html`<ol class="rail__list">${rail.slice(0, 4 - Math.min(setup.length, 2)).map(railItem)}${setup.slice(0, 2).map((x) => html`<li class="rail__item">${mark(x.mark)}<div><div class="rail__name">${x.name}</div><p class="rail__why">${x.why}</p></div><a class="btn btn--s" href="${x.href}">${x.verb}</a></li>`)}</ol>` : html`<div class="rail__list rail__empty">${allClear ? 'Sentinel re-checks every agent on schedule. You will see it here if something changes.' : 'Nothing else is waiting. Every other agent is cleared.'}</div>`}
        </div>
      </div>

      <div>
        <div class="section-head">
          <div><h2 class="h2">All agents</h2><p class="body">${Word(agents.length)} ${plural(agents.length, 'agent')}, ${needCount ? `${word(needCount)} ${plural(needCount, 'needs', 'need')} you` : 'none need you'}${runningCount ? `, ${word(runningCount)} running now` : ''}.</p></div>
          <a class="btn" href="#/add">Add agent</a>
        </div>
        <div style="margin-top:var(--s4)">
        <table class="roster">
          <thead><tr><th class="c-seal"><span class="sr">Grade</span></th><th>Agent</th><th>Last run</th><th>Last cleared</th><th>Sentinel</th><th>Ledger</th></tr></thead>
          <tbody>${ranked.map(rosterRow)}</tbody>
        </table>
        </div>
      </div>

    </section>`);

  const heroEl = $('.hero', main);
  if (!arrivedOnce) { heroEl.classList.add('is-arriving'); arrivedOnce = true; }
  bindFirstAgent(main, ctx);
  if (ctx.query.first) $('#fa-url', main)?.focus();
  $$('[data-start]', main).forEach((b) => b.addEventListener('click', () => startRun(b.dataset.start, ctx.go, b)));
  $$('.roster tbody tr', main).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a, button')) ctx.go(tr.dataset.href); }));

  // Live: keep running agents ticking without re-rendering the page.
  const live = ranked.filter((x) => x.state === 'running');
  if (live.length) {
    const t = setInterval(async () => {
      for (const item of live) {
        const r = await api.run(item.run.id).catch(() => null);
        if (!ctx.alive() || !r) return;
        if (r.status !== 'running' && r.status !== 'queued') { clearInterval(t); render(main, ctx); return; }
        $$(`[data-live="${r.id}"]`, main).forEach((el) => { el.textContent = `${r.progress.done} of ${r.progress.total}`; });
        $$(`[data-live-strip="${r.id}"]`, main).forEach((el) => { el.innerHTML = String(runStrip(r, el.dataset.size)); });
        $$(`[data-live-why="${r.id}"]`, main).forEach((el) => { el.textContent = `${r.progress.done} of ${r.progress.total} probes done. You can leave this page; the run keeps going.`; });
      }
    }, 1000);
    ctx.onLeave(() => clearInterval(t));
  }
}

// Strip for a run that is still going: done cells, the current one, and the rest.
export function runStrip(run, size = 'm') {
  const total = run.progress.total || 40;
  const per = Math.ceil(total / CATEGORY_ORDER.length);
  const cells = Array.from({ length: total }, (_, i) => ({
    category: CATEGORY_ORDER[Math.min(CATEGORY_ORDER.length - 1, Math.floor(i / per))],
    state: i < run.progress.done ? 'done' : i === run.progress.done ? 'current' : 'pending',
  }));
  return strip(cells, { size, label: `${run.progress.done} of ${total} probes done` });
}

function heroTile(x, needCount) {
  const a = x.agent;
  const report = x.run?.report;
  const top = x.state === 'running'
    ? html`<span class="mark mark--running" aria-hidden="true"></span>Live now`
    : html`${mark(x.state === 'broken' ? 'broken' : x.state)}${needCount > 1 ? `The first of ${word(needCount)} agents that need you` : 'The one agent that needs you'}`;
  return html`
    <div class="hero" aria-labelledby="hero-h">
      <div class="hero__top">${top}</div>
      <div>
        <div style="display:flex;gap:var(--s5);align-items:flex-start">
          <div style="min-width:0;flex:1">
            ${raw(String(h1(x.headline)).replace('<h1 ', '<h1 id="hero-h" '))}
            <p class="lede" ${raw(x.state === 'running' ? `data-live-why="${x.run.id}"` : '')}>${x.why}</p>
            ${x.rule ? html`<p class="hero__why">${x.rule}</p>` : ''}
          </div>
        </div>
      </div>
      <div class="hero__foot">
        ${x.action.run
          ? html`<button class="btn btn--primary" data-start="${x.action.run}" data-autofocus>${x.action.label}</button>`
          : html`<a class="btn btn--primary" href="${x.action.href}" data-autofocus>${x.action.label}</a>`}
        <a class="btn btn--quiet" href="#/agents/${a.id}/report">Open the full report</a>
        <span style="margin-left:auto" class="hero__strip">
          ${x.state === 'running' ? html`<span data-live-strip="${x.run.id}" data-size="l">${runStrip(x.run, 'l')}</span>` : report ? strip(stripFromFindings(report.findings), { size: 'l', label: `${report.passed} passed, ${report.failed} failed, ${report.inconclusive} inconclusive` }) : ''}
        </span>
      </div>
    </div>`;
}

function heroAllClear(agents) {
  const next = agents.map((a) => a.sentinel?.nextRunAt).filter(Boolean).sort()[0];
  return html`
    <div class="hero">
      <div class="hero__top">${mark('pass')}Everything is cleared</div>
      <div>
        ${h1('Nothing needs you.')}
        <p class="lede">Every agent passed its last run or has a decision on record.${next ? ` Sentinel runs the next check ${until(next)}.` : ' Turn on sentinel to re-check them on a schedule.'}</p>
      </div>
      <div class="hero__foot"><a class="btn btn--primary" href="#/add" data-autofocus>Add another agent</a></div>
    </div>`;
}

function railItem(x) {
  const a = x.action;
  return html`<li class="rail__item">
    ${x.state === 'running' ? html`<span class="mark mark--running" aria-hidden="true"></span>` : mark(x.state)}
    <div>
      <div class="rail__name">${x.agent.name}</div>
      <p class="rail__why" ${raw(x.state === 'running' ? `data-live="${x.run.id}"` : '')}>${x.state === 'running' ? `${x.run.progress.done} of ${x.run.progress.total}` : x.short}</p>
    </div>
    ${a.run ? html`<button class="btn btn--s" data-start="${a.run}">${a.label.replace(' now', '')}</button>` : html`<a class="btn btn--s" href="${a.href}">${shortVerb(x)}</a>`}
  </li>`;
}

function shortVerb(x) {
  if (x.state === 'running') return 'Watch';
  if (x.state === 'broken') return 'Trace';
  return 'Fix';
}

function rosterRow(x) {
  const a = x.agent;
  const r = x.run;
  const running = r && (r.status === 'queued' || r.status === 'running');
  const report = r?.report;
  const stale = isStale(a);
  let lastRun;
  if (running) lastRun = html`<span data-live-strip="${r.id}" data-size="s">${runStrip(r, 's')}</span>`;
  else if (report) lastRun = strip(stripFromFindings(report.findings), { size: 's', label: `${report.passed} passed, ${report.failed} failed, ${report.inconclusive} inconclusive` });
  else if (r?.status === 'failed') lastRun = html`<span class="statusline">${mark('fail', { size: 's' })}Stopped</span>`;
  else lastRun = html`<span class="statusline">${mark('pending', { size: 's' })}Never probed</span>`;
  const href = running ? `#/runs/${r.id}` : `#/agents/${a.id}/report`;
  return html`<tr data-href="${href}">
    <td class="c-seal">${seal(a.grade, { size: 's', stale, running })}</td>
    <td><a class="roster__name" href="${href}">${a.name}</a><span class="roster__url">${a.url}</span></td>
    <td>${lastRun}</td>
    <td><span class="statusline">${stale ? html`${mark('stale', { size: 's' })}<span class="t-stale">${ago(a.lastRunAt)}</span>` : running ? html`<span data-live="${r.id}">${r.progress.done} of ${r.progress.total}</span>` : ago(a.lastRunAt)}</span></td>
    <td><span class="statusline">${a.sentinel?.enabled ? html`${mark('ok', { size: 's' })}Every ${a.sentinel.intervalHours}h` : html`${mark('off', { size: 's' })}Off`}</span></td>
    <td><span class="statusline">${a.chain?.valid === false ? html`${mark('broken', { size: 's' })}<span class="t-gap">Does not verify</span>` : a.chain?.length ? html`${mark('pass', { size: 's' })}${a.chain.length} entries` : html`${mark('pending', { size: 's' })}Empty`}</span></td>
  </tr>`;
}

export function intStrip(ints) {
  if (ints?.error) return html`<div class="intstrip"><span>${mark('stale', { size: 's' })}Integration status did not load: ${ints.error.message}</span><a class="link" href="#/integrations">Check integrations</a></div>`;
  const names = { maritime: 'Maritime', keiki: 'Keiki alerts', supermemory: 'Supermemory' };
  return html`<div class="intstrip" aria-label="Integrations">
    ${Object.entries(names).map(([k, n]) => {
      const s = ints[k];
      if (!s) return '';
      const st = !s.configured ? 'off' : s.ok === false ? 'broken' : 'ok';
      return html`<span>${mark(st, { size: 's' })}<b>${n}</b> ${!s.configured ? 'not configured' : s.ok === false ? 'failing' : 'connected'}</span>`;
    })}
    <a class="link" href="#/integrations" style="margin-left:auto">Integration details</a>
  </div>`;
}
