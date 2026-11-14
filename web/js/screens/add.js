// Add an agent: paste a chat endpoint (Loxe says hello first and explains what's wrong if it can't
// talk to it), test one with no URL by hand, or pick a Maritime-hosted agent when that's enabled.
import { api, isDemo } from '../api.js';
import { endpointHelp } from '../endpoint-help.js';
import { checkCard, checking, checkFailed } from '../endpoint-check.js';
import { html, $, $$, mark, toast, h1 } from '../ui.js';

export async function render(main, ctx) {
  main.innerHTML = String(html`
    <section class="page">
      <div>
        <a class="crumb" href="#/">All agents</a>
        <div style="margin-top:var(--s3)">${h1('Point Loxe at an agent.')}</div>
        <p class="lede">Give it the URL your app sends chat messages to. Loxe says hello first, so you know it can actually reach your agent before it throws 40 attacks at it.</p>
      </div>
      <div class="split split--60">
        <form class="panel" id="addform" novalidate>
          <h2 class="h3">Paste the chat endpoint</h2>
          <p class="body" style="margin-bottom:var(--s5)">Not your GitHub repo and not your homepage. The API route your chat box calls, like <code class="mono">/api/chat</code>.</p>
          <div class="field">
            <label class="label" for="f-url">Endpoint URL</label>
            <div class="urlrow">
              <input class="input input--mono" id="f-url" name="url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://your-app.vercel.app/api/chat" required data-autofocus>
              <button class="btn" type="button" id="checkbtn">Say hello</button>
            </div>
            <span class="field__error" id="e-url" hidden></span>
            <div id="checkout" aria-live="polite"></div>
            <span class="field__hint"><a class="link" href="#/security">What Loxe sends and stores</a>. A staging copy with fake data is the ideal target.</span>
            ${endpointHelp()}
          </div>
          <div class="field">
            <label class="label" for="f-name">Name</label>
            <input class="input" id="f-name" name="name" autocomplete="off" placeholder="Support Copilot" required>
            <span class="field__hint">Shows on the public clearance page and the badge.</span>
          </div>
          <details class="more" id="authbox" style="margin-top:var(--s4)">
            <summary>Add an auth header</summary>
            <div class="field" style="margin-top:var(--s2)">
              <label class="label" for="f-hname">Header name</label>
              <input class="input input--mono" id="f-hname" autocomplete="off" spellcheck="false" placeholder="Authorization">
            </div>
            <div class="field">
              <label class="label" for="f-hval">Header value</label>
              <input class="input input--mono" id="f-hval" type="password" autocomplete="off" spellcheck="false" placeholder="Bearer ...">
              <span class="field__hint">Sent with every test. Encrypted at rest, kept out of the ledger and the report, and never shown again.</span>
            </div>
          </details>
          <div class="state state--error" id="formerr" hidden role="alert" style="margin-top:var(--s4)"></div>
          <div class="row" style="margin-top:var(--s5)">
            <button class="btn btn--primary" type="submit" data-mode="run">Add and run the 40 tests</button>
            <button class="btn" type="submit" data-mode="add">Just add it</button>
          </div>
          <p class="small" id="anyway" hidden style="margin-top:var(--s3)">Sure it's right? <button class="linkbtn" type="button" id="anywaybtn">Add it anyway</button> and let the tests sort it out.</p>
        </form>
        <div class="stack">
        <form class="panel" id="handform" aria-labelledby="hand-h" novalidate>
          <h2 class="h3" id="hand-h">No URL? Test it by hand</h2>
          <p class="body">Custom GPT, Claude project, a bot that lives in iMessage. Loxe hands you each attack, you send it to your agent and paste back what it said. About 20 minutes and a little patience.</p>
          <div class="field" style="margin-top:var(--s4)">
            <label class="label" for="h-name">Agent name</label>
            <input class="input" id="h-name" autocomplete="off" placeholder="Instinct" required>
          </div>
          <div class="field">
            <label class="label" for="h-where">Where you talk to it</label>
            <input class="input" id="h-where" autocomplete="off" placeholder="iMessage">
          </div>
          <div class="state state--error" id="handerr" hidden role="alert"></div>
          <button class="btn" type="submit" style="margin-top:var(--s2)">Start the test</button>
        </form>
        <aside class="panel" id="maritime" aria-labelledby="mt-h" hidden>
          <h2 class="h3" id="mt-h">Or pick a Maritime agent</h2>
          <p class="body">One click. Loxe reads the URL from Maritime and starts the run.</p>
          <div id="mt-list" style="margin-top:var(--s4)"></div>
        </aside>
        </div>
      </div>
    </section>`);

  const form = $('#addform', main);
  if (ctx.query.url) { $('#f-url', form).value = ctx.query.url; $('#f-name', form).value = ctx.query.name || ''; }
  let mode = 'run';
  let checked = null; // { key, result } for the URL and header last checked
  $$('button[type="submit"]', form).forEach((b) => b.addEventListener('click', () => { mode = b.dataset.mode; }));
  const urlIn = $('#f-url', form);
  const nameIn = $('#f-name', form);
  const out = $('#checkout', form);
  const checkBtn = $('#checkbtn', form);
  const headerPair = () => {
    const hn = $('#f-hname', form).value.trim();
    const hv = $('#f-hval', form).value;
    return hn && hv ? { [hn]: hv } : null;
  };
  const key = () => `${urlIn.value.trim()}\n${JSON.stringify(headerPair() || {})}`;
  const parseUrl = () => {
    let u;
    try { u = new URL(urlIn.value.trim()); } catch {}
    return u && /^https?:$/.test(u.protocol) ? u : null;
  };
  const showUrlError = (msg) => {
    const err = $('#e-url', form);
    err.textContent = msg;
    err.hidden = false;
    urlIn.setAttribute('aria-invalid', 'true');
    urlIn.focus();
  };

  function paint(r) {
    $('#anyway', form).hidden = r.ok;
    out.innerHTML = String(checkCard(r));
    if (r.kind === 'auth') $('#authbox', form).open = true;
  }

  async function runCheck() {
    $('#e-url', form).hidden = true;
    urlIn.removeAttribute('aria-invalid');
    const u = parseUrl();
    if (!u) { showUrlError('Paste the full address, starting with https://.'); return null; }
    if (checked && checked.key === key()) return checked.result;
    checkBtn.classList.add('is-busy'); checkBtn.disabled = true;
    out.innerHTML = String(checking());
    try {
      const h = headerPair();
      const result = await api.checkEndpoint({ url: u.toString(), ...(h ? { headers: h } : {}) });
      checked = { key: key(), result };
      paint(result);
      return result;
    } catch (e) {
      out.innerHTML = String(checkFailed(e.message));
      return null;
    } finally {
      checkBtn.classList.remove('is-busy'); checkBtn.disabled = false;
    }
  }

  checkBtn.addEventListener('click', runCheck);
  urlIn.addEventListener('input', () => {
    $('#e-url', form).hidden = true;
    urlIn.removeAttribute('aria-invalid');
    if (checked && checked.key !== key()) { out.innerHTML = ''; $('#anyway', form).hidden = true; }
  });
  urlIn.addEventListener('paste', () => setTimeout(() => { if (parseUrl()) runCheck(); }, 0));
  // The name follows the URL until someone types their own.
  nameIn.addEventListener('input', () => { delete nameIn.dataset.auto; });
  urlIn.addEventListener('blur', () => {
    if ((!nameIn.value || nameIn.dataset.auto) && urlIn.value) {
      try {
        const host = new URL(urlIn.value).hostname.split('.')[0];
        nameIn.value = host.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        nameIn.dataset.auto = '1';
      } catch {}
    }
  });

  async function submit(force) {
    $('#formerr', form).hidden = true;
    const u = parseUrl();
    if (!u) { showUrlError('Paste the full address, starting with https://.'); return; }
    const r = force ? checked?.result : await runCheck();
    if (!force && (!r || !r.ok)) { out.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
    const body = { name: nameIn.value.trim() || u.hostname, url: u.toString(), source: 'url', wire: r?.wire || 'messages' };
    const h = headerPair();
    if (h) body.headers = h;
    const btn = force ? $('#anywaybtn', form) : $(`button[data-mode="${mode}"]`, form);
    await create(body, force ? true : mode === 'run', btn, ctx, $('#formerr', form));
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(false); });
  $('#anywaybtn', form).addEventListener('click', () => submit(true));

  const hand = $('#handform', main);
  if (ctx.query.hand) { hand.scrollIntoView({ block: 'start' }); $('#h-name', hand).focus(); }
  hand.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('#h-name', hand).value.trim();
    const err = $('#handerr', hand);
    err.hidden = true;
    if (!name) { err.textContent = 'Give the agent a name.'; err.hidden = false; $('#h-name', hand).focus(); return; }
    if (isDemo()) { toast('The demo uses sample agents. Leave the demo to test your own.', 'gap'); return; }
    const b = hand.querySelector('button');
    b.classList.add('is-busy'); b.disabled = true;
    try {
      const a = await api.createAgent({ name, source: 'hand', where: $('#h-where', hand).value.trim() || 'an app' });
      const r = await api.startRun(a.id);
      ctx.go(`#/runs/${r.runId}`);
    } catch (er) { err.textContent = er.message; err.hidden = false; b.classList.remove('is-busy'); b.disabled = false; }
  });

  // Maritime pane: only shown when this org can actually pick hosted agents from it.
  const list = await api.maritimeAgents().catch(() => []);
  if (!ctx.alive() || !Array.isArray(list) || !list.length) return;
  const pane = $('#maritime', main);
  pane.hidden = false;
  const box = $('#mt-list', main);
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
    const msg = e.status === 400 ? `The server turned this endpoint down: ${e.message}.` : e.message;
    if (errBox) { errBox.hidden = false; errBox.innerHTML = String(html`<div class="state__head">${mark('fail')}<b>Not added.</b></div><p class="body">${msg}</p>`); }
    else toast(msg, 'gap');
  }
}
