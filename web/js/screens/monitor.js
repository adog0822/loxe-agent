// Monitor: sentinel toggle and interval, Keiki alert status, run history, Supermemory history.
import { api } from '../api.js';
import { html, raw, $, mark, seal, h1, ago, until, when, toast, skeleton, sentence } from '../ui.js';
import { agentHeader, bindRunButtons, loadAgent } from './common.js';

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
          <form class="panel" id="sentinel">
            <label class="switch"><input type="checkbox" id="s-on" ${raw(agent.sentinel.enabled ? 'checked' : '')} data-autofocus> <span id="s-label">${agent.sentinel.enabled ? 'Sentinel is on' : 'Sentinel is off'}</span></label>
            <div class="field" style="margin-top:var(--s4)">
              <label class="label" for="s-int">Re-run</label>
              <select class="select" id="s-int" style="max-width:280px">${INTERVALS.map(([h, l]) => html`<option value="${h}" ${raw(agent.sentinel.intervalHours === h ? 'selected' : '')}>${l}</option>`)}</select>
            </div>
            <p class="body small" id="s-next">${nextLine(agent.sentinel)}</p>
          </form>
          <div class="panel">
            <h2 class="h3">Alerts</h2>
            ${!keiki ? html`<p class="body">${mark('stale', { size: 's' })} Alert status did not load.</p>`
              : !keiki.configured ? html`<p class="body">${mark('off', { size: 's' })} <b>Keiki is not configured.</b> ${sentence(keiki.detail || 'Set KEIKI_API_KEY on the Loxe server')} Sentinel still runs; nobody is told when the grade drops.</p><a class="link" href="#/integrations">See integration setup</a>`
              : keiki.ok === false ? html`<p class="body">${mark('broken', { size: 's' })} <b>Keiki is failing.</b> ${sentence(keiki.detail)}</p>`
              : html`<p class="body">${mark('ok', { size: 's' })} Keiki alerts the agent owner when a re-run grades lower than the last one, or when the ledger stops verifying.</p>`}
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
            ${sm && !sm.configured ? html`<p class="body">${mark('off', { size: 's' })} Supermemory is not configured. ${sentence(sm.detail || 'Set SUPERMEMORY_API_KEY on the Loxe server')}</p>`
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
  const save = async () => {
    on.disabled = true; sel.disabled = true;
    try {
      const s = await api.sentinel(agent.id, { enabled: on.checked, intervalHours: Number(sel.value) });
      agent.sentinel = s;
      $('#s-label', main).textContent = s.enabled ? 'Sentinel is on' : 'Sentinel is off';
      $('#s-next', main).textContent = nextLine(s);
      toast(s.enabled ? `Sentinel on. Next run ${until(s.nextRunAt)}.` : 'Sentinel off. The clearance date will start to age.');
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
