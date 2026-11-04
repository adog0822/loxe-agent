// Integrations: what each one does for the user. Server-side config detail stays in the server log.
import { api, isDemo, BASE } from '../api.js';
import { html, raw, $, $$, mark, h1, ago, toast, copy } from '../ui.js';
import { say } from '../owl.js';
import { workflowYaml } from './ci.js';

const ROWS = [
  ['maritime', 'Maritime', 'Pick an agent you host on Maritime instead of pasting its URL. Loxe checks it again on every deploy.'],
  ['keiki', 'Keiki', 'Messages you on Slack, iMessage, Telegram or email when a grade drops or the ledger breaks.'],
  ['supermemory', 'Supermemory', 'Keeps the history of every run, so Loxe can tell you what changed since last time.'],
];

const STATE = (s) =>
  !s.configured ? ['off', 'Not available yet']
  : s.ok === false ? ['broken', 'Down right now']
  : s.partial ? ['stale', 'Coming soon']
  : s.ok === null ? ['stale', 'Not checked yet']
  : ['ok', 'Connected'];

export async function render(main, ctx) {
  const [ints, team, agents] = await Promise.all([
    api.integrations(),
    api.teamIntegrations().catch((e) => ({ error: e })),
    api.agents().catch(() => []),
  ]);
  if (!ctx.alive()) return;
  main.innerHTML = String(html`
    <section class="page">
      <div>
        <a class="crumb" href="#/">All agents</a>
        <div style="margin-top:var(--s3)">${h1('What Loxe connects to.')}</div>
        <p class="lede">Connect Slack and GitHub for your team. The rest Loxe runs for you.</p>
      </div>
      <div class="csecs">
        <section class="csec" id="i-slack">${slackBlock(team)}</section>
        <section class="csec" id="i-github">${githubBlock(team, agents)}</section>
      </div>
      <h2 class="h2" style="margin-top:var(--s7)">Built in</h2>
      <p class="body" style="margin:var(--s1) 0 var(--s4)">Loxe runs these for you. You do not need any of them: Loxe tests an agent hosted anywhere, from its URL.</p>
      <ul class="ints">
        ${ROWS.map(([k, name, what]) => {
          const [st, word] = STATE(ints[k] || { configured: false });
          return html`<li class="int">
            ${mark(st)}
            <div><div class="int__name">${name}</div><div class="small">${word}</div></div>
            <div><div class="int__detail">${what}</div></div>
            <div class="small">${ints[k]?.checkedAt ? `Checked ${ago(ints[k].checkedAt)}` : ''}</div>
          </li>`;
        })}
        <li class="int">
          ${mark('ok')}
          <div><div class="int__name">Sign-in</div><div class="small">${ints.auth?.provider === 'clerk' ? 'Clerk' : 'Dev sign-in'}</div></div>
          <div><div class="int__detail">${ints.auth?.provider === 'clerk' ? 'Your account and team. Only people in your team see your private agents.' : 'Development sign-in. Not for real use.'}</div></div>
          <div class="small">${isDemo() ? 'Demo data' : ''}</div>
        </li>
      </ul>
    </section>`);
  bind(main, ctx);
}

const MODE_LABEL = { changes: 'Grade changes and ledger breaks', every: 'Every finished test' };

function seg(name, value, options) {
  return html`<div class="seg" role="group" aria-label="${name}">${options.map(([v, label]) => html`<button type="button" data-${raw(name)}="${v}" aria-pressed="${v === value}">${label}</button>`)}</div>`;
}

function slackBlock(team) {
  const s = team?.slack;
  const head = html`<div class="csec__head"><h2 class="h2">Slack</h2><p class="body">Loxe posts in a channel you pick when an agent's grade changes, when its evidence ledger stops verifying, or when a test cannot finish.</p></div>`;
  if (team?.error) return html`${head}<p class="body">${mark('stale', { size: 's' })} Did not load: ${team.error.message}</p>`;
  if (!s?.connected) return html`${head}
    <ol class="isteps body">
      <li>In Slack, open <b>Tools &gt; Apps</b>, add <b>Incoming WebHooks</b>, and pick the channel.</li>
      <li>Copy the webhook URL it gives you and paste it here.</li>
    </ol>
    <form class="intform" id="slackform">
      <label class="sr" for="slack-url">Slack webhook URL</label>
      <input class="input mono" id="slack-url" placeholder="https://hooks.slack.com/services/..." autocomplete="off" spellcheck="false" required>
      <button class="btn btn--primary" type="submit">Connect Slack</button>
    </form>
    <div class="intform__opts"><span class="small">Post on</span>${seg('slackmode', 'changes', Object.entries(MODE_LABEL))}</div>
    <p class="hint">Loxe sends one test message when you connect. The URL is encrypted and never shown again.</p>`;
  return html`${head}
    <p class="body">${mark(s.lastStatus === 'delivered' ? 'ok' : 'broken', { size: 's' })} Connected to the webhook ending in <span class="mono">${s.hint}</span>. Last message: ${s.lastStatus || 'none yet'}${s.lastAt ? `, ${ago(s.lastAt)}` : ''}.</p>
    <div class="intform__opts"><span class="small">Post on</span>${seg('slackmode', s.mode, Object.entries(MODE_LABEL))}</div>
    <div class="intform__btns"><button class="btn" type="button" id="slack-test">Send a test message</button><button class="btn btn--quiet btn--gap" type="button" id="slack-off">Disconnect</button></div>`;
}

function githubBlock(team, agents) {
  const last = team?.github?.lastRun;
  const pick = agents.find((a) => a.id === last?.agentId) || agents[0];
  return html`<div class="csec__head"><h2 class="h2">GitHub</h2><p class="body">Test your agent on every pull request and deploy. The check fails when the grade is worse than the minimum you set, so a pull request that makes the agent less safe cannot merge.</p></div>
    ${last ? html`<p class="body">${mark(last.status === 'completed' ? 'ok' : last.status === 'failed' ? 'broken' : 'stale', { size: 's' })} Last check from GitHub: <b>${last.agentName}</b>, ${last.grade ? `grade ${last.grade}` : last.status}${last.at ? `, ${ago(last.at)}` : ''}.</p>` : html`<p class="hint">No checks from GitHub yet.</p>`}
    ${!agents.length ? html`<p class="body">Add an agent first. <a class="link" href="#/add">Add agent</a></p>` : html`
    <ol class="isteps body">
      <li><div>Create a key for GitHub.</div>
        <div class="intform__btns"><button class="btn" type="button" id="gh-key">Create key</button></div><div id="gh-newkey"></div></li>
      <li>In your repo, open <b>Settings &gt; Secrets and variables &gt; Actions</b> and add it as <code class="mono">LOXE_API_KEY</code>.</li>
      <li><div>Pick the agent and the lowest grade you accept, then add this file to the repo.</div>
        <div class="intform__opts">
          <label class="small" for="gh-agent">Agent</label>
          <select class="select" id="gh-agent">${agents.map((a) => html`<option value="${a.id}" ${raw(a.id === pick?.id ? 'selected' : '')}>${a.name}</option>`)}</select>
          <label class="small" for="gh-min">Lowest grade</label>
          <select class="select" id="gh-min">${['A', 'B', 'C', 'D'].map((g) => html`<option ${raw(g === 'B' ? 'selected' : '')}>${g}</option>`)}</select>
        </div>
        <div class="snip"><div class="snip__head"><span class="small mono">.github/workflows/loxe.yml</span><button class="btn btn--s" type="button" id="gh-copy">Copy</button></div><pre class="raw" id="gh-yaml">${workflowYaml(pick?.id, 'B')}</pre></div></li>
      <li>To block merges, add <b>loxe</b> as a required check in <b>Settings &gt; Branches</b>.</li>
    </ol>`}`;
}

function bind(main, ctx) {
  const rerender = () => render(main, ctx);
  let mode = 'changes';
  $$('[data-slackmode]', main).forEach((b) => b.addEventListener('click', async () => {
    mode = b.dataset.slackmode;
    $$('[data-slackmode]', main).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (!$('#slackform', main)) {
      try { await api.slackMode(mode); say(mode === 'every' ? 'Slack will hear about every finished test.' : 'Slack will hear only when something changes.'); } catch (e) { toast(e.message, 'gap'); }
    }
  }));
  $('#slackform', main)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.target.querySelector('button');
    b.classList.add('is-busy'); b.disabled = true;
    try {
      await api.slackConnect($('#slack-url', main).value.trim(), mode);
      say('Slack is connected. Check the channel for the test message.');
      return rerender();
    } catch (er) { toast(er.message, 'gap'); }
    b.classList.remove('is-busy'); b.disabled = false;
  });
  $('#slack-test', main)?.addEventListener('click', async (e) => {
    e.target.classList.add('is-busy');
    try { await api.slackTest(); toast('Test message sent.'); } catch (er) { toast(er.message, 'gap'); }
    rerender();
  });
  $('#slack-off', main)?.addEventListener('click', async () => {
    try { await api.slackDisconnect(); say('Slack is disconnected. Loxe will not post there again.'); } catch (er) { toast(er.message, 'gap'); }
    rerender();
  });

  const yaml = () => workflowYaml($('#gh-agent', main).value, $('#gh-min', main).value);
  ['#gh-agent', '#gh-min'].forEach((sel) => $(sel, main)?.addEventListener('change', () => { $('#gh-yaml', main).textContent = yaml(); }));
  $('#gh-copy', main)?.addEventListener('click', () => { copy(yaml(), 'Workflow copied'); say('Save it as .github/workflows/loxe.yml and push.'); });
  $('#gh-key', main)?.addEventListener('click', async (e) => {
    const b = e.target;
    b.classList.add('is-busy'); b.disabled = true;
    try {
      const k = await api.createKey('GitHub Actions');
      $('#gh-newkey', main).innerHTML = String(html`<div class="newkey" role="status"><p class="body"><b>Copy this key now.</b> It will not be shown again.</p><div class="copyfield"><input class="input" readonly value="${k.key}" aria-label="New API key"><button class="btn btn--primary" type="button" id="gh-keycopy">Copy key</button></div></div>`);
      $('#gh-keycopy', main).addEventListener('click', () => copy(k.key, 'Key copied'));
      b.remove();
    } catch (er) { toast(`No key created: ${er.message}`, 'gap'); b.classList.remove('is-busy'); b.disabled = false; }
  });
}
