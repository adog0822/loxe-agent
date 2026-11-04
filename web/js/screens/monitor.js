// Monitor: sentinel toggle and interval, Keiki alert status, run history, Supermemory history.
import { api } from '../api.js';
import { html, raw, $, mark, seal, h1, ago, until, when, toast, skeleton, sentence } from '../ui.js';
import { agentHeader, bindRunButtons, loadAgent } from './common.js';
import { setContext, say } from '../owl.js';
import { getPrefs, alertLabel } from '../prefs.js';

const INTERVALS = [[1, 'Every hour'], [6, 'Every 6 hours'], [12, 'Every 12 hours'], [24, 'Every day'], [72, 'Every 3 days'], [168, 'Every week']];

export async function render(main, ctx) {
  const { agent, run } = await loadAgent(ctx.params[0]);
  const [ints, runs, memory] = await Promise.all([
    api.integrations().catch(() => null),
    api.runs(agent.id).catch((e) => ({ error: e })),
    api.memory(agent.id).catch((e) => ({ error: e })),
  ]);
  if (!ctx.alive()) return;
  const running = run && (run.status === 'queued' || run.status === 'running');
  const keiki = ints?.keiki;
  const alertPref = alertLabel(getPrefs(ctx.session.user?.id)?.alerts);
  setContext({ route: 'monitor', agentId: agent.id }, ['How does sentinel work?', 'Where do alerts go?', 'What triggers a re-run?']);
  const sm = ints?.supermemory;

  main.innerHTML = String(html`
    <section class="page">
      ${agentHeader(agent, 'monitor', running ? run : null)}
      <div class="split split--60">
        <div class="side">
          <div>
            ${h1(agent.sentinel.enabled ? 'Sentinel keeps this clearance fresh.' : 'Keep this clearance fresh.')}
            <p class="lede">Sentinel re-runs the same battery on a schedule and on every Maritime deploy. If the grade drops, Keiki tells the owner.</p>
          </div>
          ${agent.source === 'hand' ? html`<div class="panel"><p class="body">${mark('off', { size: 's' })} Scheduled re-tests need a URL. ${agent.name} is tested by hand, so start a new hand test when it changes.</p><button class="btn" type="button" data-run-agent="${agent.id}" style="margin-top:var(--s3)">Test again by hand</button></div>` : html`<form class="panel" id="sentinel">
            <label class="switch"><input type="checkbox" id="s-on" ${raw(agent.sentinel.enabled ? 'checked' : '')} data-autofocus> <span id="s-label">${agent.sentinel.enabled ? 'Sentinel is on' : 'Sentinel is off'}</span></label>
            <div class="field" style="margin-top:var(--s4)">
              <label class="label" for="s-int">Re-run</label>
              <select class="select" id="s-int" style="max-width:280px">${INTERVALS.map(([h, l]) => html`<option value="${h}" ${raw(agent.sentinel.intervalHours === h ? 'selected' : '')}>${l}</option>`)}</select>
            </div>
            <p class="body small" id="s-next">${nextLine(agent.sentinel)}</p>
          </form>`}
          <div class="panel">
            <h2 class="h3">Alerts</h2>
            ${!keiki ? html`<p class="body">${mark('stale', { size: 's' })} Alert status did not load.</p>`
              : !keiki.configured ? html`<p class="body">${mark('off', { size: 's' })} <b>Alerts are not available yet.</b> Sentinel still re-tests on schedule; the grade shows here.</p>`
              : keiki.ok === false ? html`<p class="body">${mark('broken', { size: 's' })} <b>Alerts are down right now.</b> Sentinel still re-tests on schedule.</p>`
              : html`<p class="body">${mark('ok', { size: 's' })} Keiki alerts the agent owner${alertPref && alertPref !== 'No alerts' ? ` on ${alertPref}` : ''} when a re-run grades lower than the last one, or when the ledger stops verifying.</p>`}
            ${alertPref ? html`<p class="hint">You asked for alerts on ${alertPref}. <a class="link" href="#/welcome?again=1">Change it</a>.</p>` : ''}
          </div>
        </div>
        <aside class="side">
          <div class="panel">
            <h2 class="h3">Run history</h2>
            ${runs.error ? html`<p class="body">${mark('stale', { size: 's' })} History did not load: ${runs.error.message}</p>`
              : !runs.length ? html`<p class="body">No runs yet. The first one starts the history.</p>`
              : html`<ol class="history" style="margin-top:var(--s3)">${runs.slice(0, 12).map((r) => html`<li>
                  ${r.status === 'completed' ? seal(r.grade, { size: 's' }) : r.status === 'failed' ? html`<span class="seal seal--s seal--none" role="img" aria-label="Stopped"></span>` : seal(null, { size: 's', running: true })}
                  <div><b>${r.status === 'completed' ? `Grade ${r.grade}` : r.status === 'failed' ? 'Stopped' : 'In progress'}</b><div class="small">${when(r.startedAt)}, battery ${r.libraryVersion || ''}</div></div>
                  ${r.status === 'completed' ? html`<a class="btn btn--s btn--quiet" href="#/agents/${agent.id}/report?run=${r.id}">Open</a>` : r.status !== 'failed' ? html`<a class="btn btn--s btn--quiet" href="#/runs/${r.id}">Watch</a>` : html`<span></span>`}
                </li>`)}</ol>`}
          </div>
          <div class="panel">
            <h2 class="h3">Remembered history</h2>
            ${sm && !sm.configured ? html`<p class="body">${mark('off', { size: 's' })} Run history across redeploys is not available yet.</p>`
              : memory.error ? html`<p class="body">${mark('stale', { size: 's' })} Supermemory did not answer: ${memory.error.message}</p>`
              : !memory.items?.length ? html`<p class="body">Nothing remembered yet. Each completed run adds a summary here.</p>`
              : html`<ul class="claim">${memory.items.slice(0, 6).map((m) => html`<li><span></span><span><b>${m.title}</b> <span class="small">${ago(m.at)}</span><br>${m.summary}</span></li>`)}</ul>`}
          </div>
        </aside>
      </div>
    </section>`);
  bindRunButtons(main, ctx.go);

  const on = $('#s-on', main);
  const sel = $('#s-int', main);
  if (!on) return;
  const save = async () => {
    on.disabled = true; sel.disabled = true;
    try {
      const s = await api.sentinel(agent.id, { enabled: on.checked, intervalHours: Number(sel.value) });
      agent.sentinel = s;
      $('#s-label', main).textContent = s.enabled ? 'Sentinel is on' : 'Sentinel is off';
      $('#s-next', main).textContent = nextLine(s);
      say(s.enabled ? `Sentinel on. Same battery again ${until(s.nextRunAt)}, and on every Maritime deploy.` : 'Sentinel off. The clearance date on the public page will start to age.');
    } catch (e) {
      on.checked = agent.sentinel.enabled;
      toast(`Sentinel not changed: ${e.message}`, 'gap');
    }
    on.disabled = false; sel.disabled = false;
  };
  on.addEventListener('change', save);
  sel.addEventListener('change', () => { if (on.checked) save(); });
  $('#sentinel', main).addEventListener('submit', (e) => e.preventDefault());
}

function nextLine(s) {
  if (!s.enabled) return 'Off. The last clearance date stays on the public page and starts to age.';
  return s.nextRunAt ? `Next run ${until(s.nextRunAt)}, at ${when(s.nextRunAt)}.` : 'On. The next run is scheduled after the current one finishes.';
}
