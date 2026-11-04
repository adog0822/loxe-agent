// "Test your first agent": one URL field, one click. Used by the welcome flow and the empty hub.
import { api } from '../api.js';
import { html, raw, $, h1 } from '../ui.js';
import { say } from '../owl.js';

export function firstAgentForm(prefs = {}, { compact = false } = {}) {
  const note = {
    maritime: html`Hosted on Maritime? <a class="link" href="#/add">Pick it from your Maritime agents</a> instead.`,
    keiki: html`Using Keiki? You can also text it <code class="mono">clear &lt;url&gt;</code>. <a class="link" href="#/connect">See the commands</a>.`,
    mcp: html`For an MCP server, paste the HTTP endpoint of the agent that uses it. <a class="link" href="#/connect">Other ways to connect</a>.`,
  }[prefs.where];
  return html`
    <form class="firstagent ${compact ? 'firstagent--compact' : ''}" id="firstagent" novalidate>
      ${compact ? '' : h1('Test your AI agent before your customers do.')}
      ${compact ? '' : html`<p class="lede">Paste your agent's URL. Loxe attacks it with 40 safety tests, grades it A to F, and gives you a report anyone can verify.</p>`}
      <div class="firstagent__row">
        <label class="sr" for="fa-url">Agent endpoint URL</label>
        <input class="input input--mono input--l" id="fa-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://your-agent.example.com/chat" data-autofocus>
        <button class="btn btn--primary btn--l" type="submit">Test my agent</button>
      </div>
      <p class="field__error" id="fa-err" hidden></p>
      ${note ? html`<p class="hint">${note}</p>` : ''}
      <p class="hint"><a class="link" href="#/security">What Loxe sends and stores</a>. Use a staging agent: some tests ask it to delete records or send email.</p>
    </form>`;
}

export function bindFirstAgent(root, ctx) {
  const form = $('#firstagent', root);
  if (!form) return;
  const input = $('#fa-url', form);
  const err = $('#fa-err', form);
  input.addEventListener('input', () => { err.hidden = true; input.removeAttribute('aria-invalid'); });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let u;
    try { u = new URL(input.value.trim()); } catch {}
    if (!u || !/^https?:$/.test(u.protocol)) {
      err.textContent = 'Enter a full URL that starts with https://.';
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.classList.add('is-busy'); btn.disabled = true;
    const isIp = /^[\d.]+$|^\[|^localhost$/.test(u.hostname);
    const name = isIp ? `Agent at ${u.host}` : u.hostname.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    try {
      say(`Saving ${u.hostname}, then queueing 40 probes.`);
      const a = await api.createAgent({ name, url: u.toString(), source: 'url' });
      const r = await api.startRun(a.id).catch((x) => (x.status === 409 && x.body?.runId ? { runId: x.body.runId } : Promise.reject(x)));
      ctx.go(`#/runs/${r.runId}`);
    } catch (x) {
      btn.classList.remove('is-busy'); btn.disabled = false;
      err.textContent = x.status === 400 ? `The server rejected this endpoint: ${x.message}.` : x.message;
      err.hidden = false;
      say('');
    }
  });
}
