// Add an agent: paste a URL (dominant pane) or pick a Maritime-hosted agent (side pane).
import { api } from '../api.js';
import { endpointHelp } from '../endpoint-help.js';
import { html, $, $$, mark, skeleton, toast, h1, esc, sentence } from '../ui.js';

export async function render(main, ctx) {
  main.innerHTML = String(html`
    <section class="page">
      <div>
        <a class="crumb" href="#/">All agents</a>
        <div style="margin-top:var(--s3)">${h1('Add an agent.')}</div>
        <p class="lede">Loxe attacks the agent with 40 safety tests and grades every reply with code, so the same build always gets the same grade.</p>
      </div>
      <div class="split split--60">
        <form class="panel" id="addform" novalidate>
          <h2 class="h3">Paste an endpoint</h2>
          <p class="body" style="margin-bottom:var(--s5)">The address your agent answers chat messages on. Loxe sends it test messages and judges the replies.</p>
          <div class="field">
            <label class="label" for="f-url">Endpoint URL</label>
            <input class="input input--mono" id="f-url" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://your-agent.example.com/chat" required data-autofocus>
            <span class="field__error" id="e-url" hidden></span>
            <span class="field__hint"><a class="link" href="#/security">What Loxe sends and stores</a>. Point it at a staging agent with fake data.</span>
            ${endpointHelp()}
          </div>
          <div class="field">
            <label class="label" for="f-name">Name</label>
            <input class="input" id="f-name" name="name" autocomplete="off" placeholder="Support Copilot" required>
            <span class="field__hint">This shows on the public clearance page and the badge.</span>
          </div>
          <details class="more" style="margin-top:var(--s4)">
            <summary>Add an auth header</summary>
            <div class="field" style="margin-top:var(--s2)">
              <label class="label" for="f-hname">Header name</label>
              <input class="input input--mono" id="f-hname" autocomplete="off" spellcheck="false" placeholder="Authorization">
            </div>
            <div class="field">
              <label class="label" for="f-hval">Header value</label>
              <input class="input input--mono" id="f-hval" type="password" autocomplete="off" spellcheck="false" placeholder="Bearer ...">
              <span class="field__hint">Sent with every probe. Never written to the ledger, the report or the replay, and never returned by the API.</span>
            </div>
          </details>
          <div class="state state--error" id="formerr" hidden role="alert" style="margin-top:var(--s4)"></div>
          <div class="row" style="margin-top:var(--s5)">
            <button class="btn btn--primary" type="submit" data-mode="run">Add and run clearance</button>
            <button class="btn" type="submit" data-mode="add">Add without running</button>
          </div>
        </form>
        <aside class="panel" id="maritime" aria-labelledby="mt-h">
          <h2 class="h3" id="mt-h">Or pick a Maritime agent</h2>
          <p class="body">One click. Loxe reads the URL from Maritime and starts the run.</p>
          <div id="mt-list" style="margin-top:var(--s4)">${skeleton(3, 'skeleton--tall')}<p class="hint" style="margin-top:var(--s3)">Asking Maritime which agents you host.</p></div>
        </aside>
      </div>
    </section>`);

  const form = $('#addform', main);
  if (ctx.query.url) { $('#f-url', form).value = ctx.query.url; $('#f-name', form).value = ctx.query.name || ''; }
  let mode = 'run';
  $$('button[type="submit"]', form).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; }));
  const urlIn = $('#f-url', form);
  const nameIn = $('#f-name', form);
  urlIn.addEventListener('input', () => { $('#e-url', form).hidden = true; urlIn.removeAttribute('aria-invalid'); });
  urlIn.addEventListener('blur', () => {
    if (!nameIn.value && urlIn.value) {
      try { const host = new URL(urlIn.value).hostname.split('.')[0]; nameIn.value = host.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); } catch {}
    }
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#e-url', form);
    err.hidden = true;
    urlIn.removeAttribute('aria-invalid');
    $('#formerr', form).hidden = true;
    let u;
    try { u = new URL(urlIn.value.trim()); } catch {}
    if (!u || !/^https?:$/.test(u.protocol)) {
      err.textContent = 'Enter a full URL that starts with https:// or http://.';
      err.hidden = false;
      urlIn.setAttribute('aria-invalid', 'true');
      urlIn.focus();
      return;
    }
    const body = { name: nameIn.value.trim() || u.hostname, url: u.toString(), source: 'url' };
    const hn = $('#f-hname', form).value.trim();
    const hv = $('#f-hval', form).value;
    if (hn && hv) body.headers = { [hn]: hv };
    const btn = $(`button[data-mode="${mode}"]`, form);
    await create(body, mode === 'run', btn, ctx, $('#formerr', form));
  });

  // Maritime side pane
  const [ints, list] = await Promise.all([
    api.integrations().catch(() => null),
    api.maritimeAgents().catch((e) => ({ error: e })),
  ]);
  if (!ctx.alive()) return;
  const box = $('#mt-list', main);
  const mt = ints?.maritime;
  if (mt && !mt.configured) {
    box.innerHTML = String(html`<div class="state"><div class="state__head">${mark('off')}<b>Maritime is not configured.</b></div><p class="body">${sentence(mt.detail || 'Set MARITIME_API_KEY on the Loxe server and restart it')} Pasting a URL works without it.</p></div>`);
    return;
  }
  if (list.error) {
    box.innerHTML = String(html`<div class="state state--error"><div class="state__head">${mark('fail')}<b>Maritime did not answer.</b></div><p class="body">${list.error.message}. Pasting a URL still works.</p></div>`);
    return;
  }
  if (!list.length) {
    box.innerHTML = String(html`<p class="body">Maritime is connected but you host no agents there yet. Deploy one with <code class="mono">maritime create</code> and it shows up here.</p>`);
    return;
  }
  const existing = await api.agents().catch(() => []);
  box.innerHTML = String(html`<ul class="pick">${list.map((m) => {
    const already = existing.find((a) => a.maritimeAgentId === m.id || a.url === m.url);
    const up = m.status === 'running';
    return html`<li>
      ${mark(up ? 'ok' : 'off', { size: 's' })}
      <div style="min-width:0"><b>${m.name}</b><span class="mono">${m.url}</span>${!up ? html`<span class="small">Stopped on Maritime. Start it before probing.</span>` : ''}</div>
      ${already ? html`<a class="btn btn--s btn--quiet" href="#/agents/${already.id}/report">Added</a>` : html`<button class="btn btn--s" data-mt="${m.id}" ${up ? '' : 'disabled'}>Probe it</button>`}
    </li>`;
  })}</ul>`);
  $$('[data-mt]', box).forEach((b) => b.addEventListener('click', () => {
    const m = list.find((x) => x.id === b.dataset.mt);
    const name = m.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    create({ name, url: m.url, source: 'maritime', maritimeAgentId: m.id }, true, b, ctx, null);
  }));
}

async function create(body, run, btn, ctx, errBox) {
  btn.classList.add('is-busy');
  btn.disabled = true;
  try {
    const agent = await api.createAgent(body);
    if (!run) { toast(`${agent.name} added.`); ctx.go(`#/agents/${agent.id}/report`); return; }
    const r = await api.startRun(agent.id);
    ctx.go(`#/runs/${r.runId}`);
  } catch (e) {
    btn.classList.remove('is-busy');
    btn.disabled = false;
    const msg = e.status === 400 ? `The server rejected this endpoint: ${e.message}.` : e.message;
    if (errBox) { errBox.hidden = false; errBox.innerHTML = String(html`<div class="state__head">${mark('fail')}<b>Not added.</b></div><p class="body">${msg}</p>`); }
    else toast(msg, 'gap');
  }
}
