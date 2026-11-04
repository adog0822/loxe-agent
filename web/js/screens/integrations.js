// Integrations: what each one does for the user. Server-side config detail stays in the server log.
import { api, isDemo } from '../api.js';
import { html, mark, h1, ago } from '../ui.js';

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
  const ints = await api.integrations();
  if (!ctx.alive()) return;
  main.innerHTML = String(html`
    <section class="page">
      <div>
        <a class="crumb" href="#/">All agents</a>
        <div style="margin-top:var(--s3)">${h1('What Loxe connects to.')}</div>
        <p class="lede">Loxe runs these for you. There is nothing to set up, and testing works without any of them.</p>
      </div>
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
}
