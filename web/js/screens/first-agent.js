// "Test your first agent": one URL field, one click. Used by the welcome flow and the empty hub.
// Loxe says hello to the URL first and explains what's wrong if it can't talk to it.
import { endpointHelp } from '../endpoint-help.js';
import { checkCard, checking, checkFailed } from '../endpoint-check.js';
import { api } from '../api.js';
import { html, $, h1 } from '../ui.js';
import { say } from '../owl.js';

export function firstAgentForm(prefs = {}, { compact = false } = {}) {
  const note = {
    maritime: html`Hosted on Maritime? <a class="link" href="#/add">Add agent</a> lists your Maritime agents when that's switched on for your team.`,
    mcp: html`For an MCP server, paste the chat endpoint of the agent that uses it. <a class="link" href="#/connect">Other ways to connect</a>.`,
  }[prefs.where];
  return html`
    <form class="firstagent ${compact ? 'firstagent--compact' : ''}" id="firstagent" novalidate>
      ${compact ? '' : h1('Find out how your agent breaks before your customers do.')}
      ${compact ? '' : html`<p class="lede">Paste the URL your app sends chat messages to. Loxe says hello, then hits it with 40 attacks and grades every reply A to F. You get the fixes, and a report anyone can check.</p>`}
      <div class="firstagent__row">
        <label class="sr" for="fa-url">Agent chat endpoint URL</label>
        <input class="input input--mono input--l" id="fa-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" placeholder="https://your-app.vercel.app/api/chat" data-autofocus>
        <button class="btn btn--primary btn--l" type="submit">Test my agent</button>
      </div>
      <p class="field__error" id="fa-err" hidden></p>
      <div id="fa-check" aria-live="polite"></div>
      <p class="hint" id="fa-anyway" hidden>Sure it's right? <button class="linkbtn" type="button" id="fa-anywaybtn">Test it anyway</button>.</p>
      ${note ? html`<p class="hint">${note}</p>` : ''}
      ${endpointHelp()}
      <p class="hint">No URL? Custom GPTs, Claude projects and bots in iMessage can be <a class="link" href="#/add?hand=1">tested by hand</a>.</p>
      <p class="hint"><a class="link" href="#/security">What Loxe sends and stores</a>. Point it at a staging agent: some tests ask it to delete records or send email.</p>
    </form>`;
}

export function bindFirstAgent(root, ctx) {
  const form = $('#firstagent', root);
  if (!form) return;
  const input = $('#fa-url', form);
  const err = $('#fa-err', form);
  const box = $('#fa-check', form);
  const anyway = $('#fa-anyway', form);
  let last = null; // { url, result }
  input.addEventListener('input', () => {
    err.hidden = true;
    input.removeAttribute('aria-invalid');
    if (last && last.url !== input.value.trim()) { box.innerHTML = ''; anyway.hidden = true; }
  });

  async function go(force) {
    let u;
    try { u = new URL(input.value.trim()); } catch {}
    if (!u || !/^https?:$/.test(u.protocol)) {
      err.textContent = 'Paste the full address, starting with https://.';
      err.hidden = false;
      input.setAttribute('aria-invalid', 'true');
      input.focus();
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    btn.classList.add('is-busy'); btn.disabled = true;
    try {
      let r = last && last.url === input.value.trim() ? last.result : null;
      if (!force && !r) {
        box.innerHTML = String(checking());
        try {
          r = await api.checkEndpoint({ url: u.toString() });
        } catch (x) {
          box.innerHTML = String(checkFailed(x.message));
          return;
        }
        last = { url: input.value.trim(), result: r };
        box.innerHTML = String(checkCard(r));
      }
      if (!force && !r.ok) { anyway.hidden = false; return; }
      const isIp = /^[\d.]+$|^\[|^localhost$/.test(u.hostname);
      const name = isIp ? `Agent at ${u.host}` : u.hostname.split('.')[0].replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      say(`Saving ${u.hostname}, then lining up 40 attacks.`);
      const a = await api.createAgent({ name, url: u.toString(), source: 'url', wire: r?.wire || 'messages' });
      const run = await api.startRun(a.id).catch((x) => (x.status === 409 && x.body?.runId ? { runId: x.body.runId } : Promise.reject(x)));
      ctx.go(`#/runs/${run.runId}`);
    } catch (x) {
      err.textContent = x.status === 400 ? `The server turned this endpoint down: ${x.message}.` : x.message;
      err.hidden = false;
      say('');
    } finally {
      btn.classList.remove('is-busy'); btn.disabled = false;
    }
  }
  form.addEventListener('submit', (e) => { e.preventDefault(); go(false); });
  $('#fa-anywaybtn', form).addEventListener('click', () => go(true));
}
