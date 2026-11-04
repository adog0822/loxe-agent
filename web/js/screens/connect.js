// Connect: every way to bring an agent in, each one click or one copy. Ordered by the welcome answers.
import { api, BASE } from '../api.js';
import { html, raw, $, $$, mark, h1, toast, ago, sentence, copy } from '../ui.js';
import { say } from '../owl.js';
import { getPrefs, alertLabel } from '../prefs.js';
import { firstAgentForm, bindFirstAgent } from './first-agent.js';

const CHANNELS = [['imessage', 'iMessage'], ['slack', 'Slack'], ['telegram', 'Telegram'], ['email', 'Email']];

export async function render(main, ctx) {
  const prefs = getPrefs(ctx.session.user?.id) || {};
  const [ints, agents, keys] = await Promise.all([
    api.integrations().catch(() => null),
    api.agents().catch(() => []),
    api.keys().catch((e) => ({ error: e })),
  ]);
  if (!ctx.alive()) return;
  const sample = agents.find((a) => a.lastRunId) || agents[0];
  const sampleRun = sample?.lastRunId ? await api.run(sample.lastRunId).catch(() => null) : null;
  const failing = sampleRun?.report?.findings.find((f) => f.status === 'fail');

  const sections = {
    url: () => html`<section class="csec" id="c-url">
      <div class="csec__head"><h2 class="h2">Paste a URL</h2><p class="body">Any HTTPS endpoint that takes <code class="mono">{"message": "..."}</code> and replies with <code class="mono">{"response": "..."}</code>.</p></div>
      ${firstAgentForm({}, { compact: true })}
    </section>`,
    maritime: () => html`<section class="csec" id="c-maritime">
      <div class="csec__head"><h2 class="h2">Pick a Maritime agent</h2><p class="body">Loxe reads the URL from Maritime and re-runs on every deploy.</p></div>
      <div id="mt-list"><p class="hint">Asking Maritime which agents you host.</p></div>
    </section>`,
    keiki: () => html`<section class="csec" id="c-keiki">
      <div class="csec__head"><h2 class="h2">Text the Keiki agent</h2><p class="body">Message the Loxe agent in Keiki from ${CHANNELS.map((c) => c[1]).join(', ').replace(/, ([^,]*)$/, ' or $1')}. It replies with the grade and a link.</p></div>
      ${ints?.keiki && !ints.keiki.configured ? html`<p class="body">${mark('off', { size: 's' })} Messaging is not available yet. The commands below work once it is.</p>` : ''}
      ${prefs.alerts && prefs.alerts !== 'none' ? html`<p class="body">You asked for alerts on <b>${alertLabel(prefs.alerts)}</b>, so start there.</p>` : ''}
      <dl class="cmds">
        ${cmd(`clear ${sample?.url || 'https://your-agent.example.com/chat'}`, 'Adds the agent if it is new and runs the full battery.')}
        ${cmd(`grade ${sample?.id || '<agent-id>'}`, 'Replies with the current grade, the date and the public page.')}
        ${cmd(`explain ${sampleRun?.id || '<run-id>'} ${failing?.probeId || '<probe-id>'}`, 'Explains one finding in plain English, with the fix.')}
      </dl>
    </section>`,
    mcp: () => html`<section class="csec" id="c-mcp">
      <div class="csec__head"><h2 class="h2">An MCP server</h2><p class="body">Loxe probes agents through the endpoint they answer on. Clear the agent that calls your MCP tools: its tool-permission probes test what those tools let it do.</p></div>
    </section>`,
    dev: () => html`<section class="csec" id="c-dev">
      <div class="csec__head"><h2 class="h2">From code and CI</h2><p class="body">Create an API key, then clear agents from a script, the CLI or every deploy.</p></div>
      <div class="dev">
        <div>
          <h3 class="h3">API key</h3>
          <form class="keyform" id="keyform"><label class="sr" for="k-name">Key name</label><input class="input" id="k-name" placeholder="CI on main" autocomplete="off"><button class="btn" type="submit">Create key</button></form>
          <div id="newkey"></div>
          <div id="keylist">${keyList(keys)}</div>
        </div>
        ${snippet('curl', 'Add an agent and start a run', curlText())}
        ${snippet('cli', 'CLI, one file, no install', `curl -O ${BASE}/cli/loxe.mjs\nexport LOXE_BASE_URL=${BASE}\nexport LOXE_API_KEY=lx_your_key\nnode loxe.mjs clear https://your-agent.example.com/chat`)}
        ${snippet('gha', 'GitHub Action: clear on every deploy, fail below a grade', ghaText(sample?.id))}
      </div>
    </section>`,
  };
  const base = ['url', 'maritime', 'keiki'];
  const first = base.includes(prefs.where) ? prefs.where : null;
  const order = prefs.where === 'mcp'
    ? ['mcp', 'url', 'dev', 'maritime', 'keiki']
    : [...(first ? [first] : []), ...base.filter((k) => k !== first), 'dev', 'mcp'];

  main.innerHTML = String(html`
    <section class="page">
      <div>
        ${h1('Bring an agent in from anywhere.')}
        <p class="lede">Every route ends the same way: the same 40 probes, the same grade, the same ledger.${prefs.where ? ' Your usual route is first.' : ''}</p>
      </div>
      <div class="csecs">${order.map((k) => sections[k]())}</div>
    </section>`);

  bindFirstAgent(main, ctx);
  $$('[data-copytext]', main).forEach((b) => b.addEventListener('click', () => { copy(b.dataset.copytext, b.dataset.copyLabel || 'Copied'); say(b.dataset.say || 'Copied to your clipboard.'); }));
  bindKeys(main);

  // Maritime list
  const box = $('#mt-list', main);
  if (ints?.maritime && !ints.maritime.configured) {
    box.innerHTML = String(html`<p class="body">${mark('off', { size: 's' })} Maritime is not available yet. Pasting a URL works without it.</p>`);
  } else {
    const list = await api.maritimeAgents().catch((e) => ({ error: e }));
    if (!ctx.alive()) return;
    if (list.error) box.innerHTML = String(html`<p class="body">${mark('fail', { size: 's' })} Maritime did not answer: ${list.error.message}</p>`);
    else if (!list.length) box.innerHTML = String(html`<p class="body">Connected, but you host no agents on Maritime yet.</p>`);
    else {
      box.innerHTML = String(html`<ul class="pick">${list.map((m) => {
        const already = agents.find((a) => a.maritimeAgentId === m.id || a.url === m.url);
        const up = m.status === 'running';
        return html`<li>${mark(up ? 'ok' : 'off', { size: 's' })}<div style="min-width:0"><b>${m.name}</b><span class="mono">${m.url}</span></div>${already ? html`<a class="btn btn--s btn--quiet" href="#/agents/${already.id}/report">Open</a>` : html`<button class="btn btn--s" data-mt="${m.id}" ${raw(up ? '' : 'disabled title="Stopped on Maritime"')}>Clear it</button>`}</li>`;
      })}</ul>`);
      $$('[data-mt]', box).forEach((b) => b.addEventListener('click', async () => {
        const m = list.find((x) => x.id === b.dataset.mt);
        b.classList.add('is-busy'); b.disabled = true;
        try {
          say(`Adding ${m.name} from Maritime, then queueing 40 probes.`);
          const a = await api.createAgent({ name: m.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()), url: m.url, source: 'maritime', maritimeAgentId: m.id });
          const r = await api.startRun(a.id);
          ctx.go(`#/runs/${r.runId}`);
        } catch (e) { toast(e.message, 'gap'); b.classList.remove('is-busy'); b.disabled = false; }
      }));
    }
  }

  const want = { maritime: 'c-maritime', keiki: 'c-keiki', mcp: 'c-mcp' }[ctx.query.to];
  if (want) $(`#${want}`, main)?.scrollIntoView({ block: 'start' });
}

function cmd(text, what) {
  return html`<div class="cmd"><dt><code class="mono">${text}</code><button class="btn btn--s btn--quiet" type="button" data-copytext="${text}" data-copy-label="Command copied" data-say="Paste it into your Keiki chat.">Copy</button></dt><dd>${what}</dd></div>`;
}

function snippet(id, title, text) {
  return html`<div class="snip"><div class="snip__head"><h3 class="h3">${title}</h3><button class="btn btn--s" type="button" data-copytext="${text}" data-copy-label="${title} copied">Copy</button></div><pre class="raw" id="snip-${id}">${text}</pre></div>`;
}

function keyList(keys) {
  if (keys?.error) return html`<p class="body">${mark('stale', { size: 's' })} Keys did not load: ${keys.error.message}</p>`;
  if (!keys?.length) return html`<p class="hint">No keys yet. A key acts for your whole organisation, so make one per system.</p>`;
  return html`<ul class="keys">${keys.map((k) => html`<li><span class="mono">${k.prefix}...</span><span>${k.name}</span><span class="small">${k.createdAt ? ago(k.createdAt) : ''}</span><button class="btn btn--s btn--quiet btn--gap" type="button" data-revoke="${k.id}">Revoke</button></li>`)}</ul>`;
}

function bindKeys(main) {
  const form = $('#keyform', main);
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = form.querySelector('button');
    b.classList.add('is-busy'); b.disabled = true;
    try {
      say('Creating a key. Copy it now: it is shown once.');
      const k = await api.createKey(form.querySelector('input').value.trim() || 'Untitled key');
      $('#newkey', main).innerHTML = String(html`<div class="newkey" role="status"><p class="body"><b>Copy this key now.</b> It will not be shown again.</p><div class="copyfield"><input class="input" readonly value="${k.key}" aria-label="New API key"><button class="btn btn--primary" type="button" data-copytext="${k.key}" data-copy-label="Key copied">Copy key</button></div></div>`);
      $$('#newkey [data-copytext]', main).forEach((x) => x.addEventListener('click', () => copy(x.dataset.copytext, 'Key copied')));
      form.querySelector('input').value = '';
      $('#keylist', main).innerHTML = String(keyList(await api.keys().catch((er) => ({ error: er }))));
      bindRevoke(main);
    } catch (er) { toast(`No key created: ${er.message}`, 'gap'); }
    b.classList.remove('is-busy'); b.disabled = false;
  });
  bindRevoke(main);
}
function bindRevoke(main) {
  $$('[data-revoke]', main).forEach((b) => b.addEventListener('click', async () => {
    b.classList.add('is-busy');
    try { await api.deleteKey(b.dataset.revoke); say('Key revoked. Anything using it now gets 401.'); $('#keylist', main).innerHTML = String(keyList(await api.keys())); bindRevoke(main); }
    catch (e) { toast(`Not revoked: ${e.message}`, 'gap'); b.classList.remove('is-busy'); }
  }));
}

const curlText = () => `export LOXE_API_KEY=lx_your_key

# Add the agent (returns its id)
curl -s -X POST ${BASE}/api/agents \\
  -H "Authorization: Bearer $LOXE_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"My agent","url":"https://your-agent.example.com/chat"}'

# Run the battery, then poll the run until it completes
curl -s -X POST ${BASE}/api/agents/<agent-id>/runs -H "Authorization: Bearer $LOXE_API_KEY"
curl -s ${BASE}/api/runs/<run-id> -H "Authorization: Bearer $LOXE_API_KEY"`;

const ghaText = (agentId) => `# .github/workflows/loxe.yml
name: Loxe clearance
on:
  deployment_status:
jobs:
  clear:
    if: github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    env:
      LOXE_BASE_URL: ${BASE}
      LOXE_API_KEY: \${{ secrets.LOXE_API_KEY }}
      LOXE_AGENT_ID: ${agentId || '<agent-id>'}
      MIN_GRADE: B
    steps:
      - name: Download the Loxe CLI
        run: curl -fsSO "$LOXE_BASE_URL/cli/loxe.mjs"
      - name: Clear the agent, fail below MIN_GRADE
        run: |
          node loxe.mjs run "$LOXE_AGENT_ID" | tee loxe.txt
          grade=$(grep -oE '^Grade [A-F]' loxe.txt | cut -d' ' -f2)
          echo "Public page: $LOXE_BASE_URL/a/$LOXE_AGENT_ID"
          [ -n "$grade" ] || { echo "No grade returned"; exit 1; }
          [[ "$grade" < "$MIN_GRADE" || "$grade" == "$MIN_GRADE" ]] || { echo "Grade $grade is below $MIN_GRADE"; exit 1; }`;
