// Integrations: Maritime, Keiki, Supermemory and auth, said plainly.
import { api, MOCK } from '../api.js';
import { html, mark, h1, ago, sentence } from '../ui.js';

const ROWS = [
  ['maritime', 'Maritime', 'Hosts agents. Lets you add one in a click and re-run on every deploy.', 'MARITIME_API_KEY'],
  ['keiki', 'Keiki', 'Approval-gated alerts. Tells the owner when a grade drops or the ledger breaks.', 'KEIKI_API_KEY'],
  ['supermemory', 'Supermemory', 'Remembers each run so history survives redeploys.', 'SUPERMEMORY_API_KEY'],
];

export async function render(main, ctx) {
  const ints = await api.integrations();
  if (!ctx.alive()) return;
  const missing = ROWS.filter(([k]) => ints[k] && !ints[k].configured).length;
  main.innerHTML = String(html`
    <section class="page">
      <div>
        <a class="crumb" href="#/">All agents</a>
        <div style="margin-top:var(--s3)">${h1(missing ? 'Some integrations are not set up.' : 'Every integration is connected.')}</div>
        <p class="lede">Probing and the ledger work without any of these. Each one adds a convenience, and each is configured on the Loxe server, not here.</p>
      </div>
      <ul class="ints">
        ${ROWS.map(([k, name, what, env]) => {
          const s = ints[k] || { configured: false, ok: null, detail: 'The server did not report this integration.' };
          const st = !s.configured ? 'off' : s.ok === false ? 'broken' : s.ok === null ? 'stale' : 'ok';
          const word = !s.configured ? 'Not configured' : s.ok === false ? 'Failing' : s.ok === null ? 'Not checked yet' : 'Connected';
          return html`<li class="int">
            ${mark(st)}
            <div><div class="int__name">${name}</div><div class="small">${word}</div></div>
            <div><div class="int__detail">${sentence(s.detail)}</div><div class="int__fix">${!s.configured ? `Not configured: set ${env} on the Loxe server and restart it.` : s.ok === false ? 'Check the key and that the service is reachable from the Loxe server.' : what}</div></div>
            <div class="small">${s.checkedAt ? `Checked ${ago(s.checkedAt)}` : ''}</div>
          </li>`;
        })}
        <li class="int">
          ${mark('ok')}
          <div><div class="int__name">Sign-in</div><div class="small">${ints.auth?.provider === 'clerk' ? 'Clerk' : 'Dev sign-in'}</div></div>
          <div><div class="int__detail">${ints.auth?.provider === 'clerk' ? 'Users sign in with Clerk. The browser sends the session token on every request.' : 'Email sign-in for development. Anyone who can reach the server can sign in.'}</div><div class="int__fix">${ints.auth?.provider === 'clerk' ? 'Managed in the Clerk dashboard.' : 'For production, set CLERK_SECRET_KEY and the Clerk publishable key on the Loxe server.'}</div></div>
          <div class="small">${MOCK ? 'Sample data' : ''}</div>
        </li>
      </ul>
    </section>`);
}
