// Share: public clearance page, badge embed, PDF. Plus what the claim says and does not say.
import { badgeSrc, publicUrl, MOCK } from '../api.js';
import { html, $, $$, mark, h1, day, word, esc } from '../ui.js';
import { agentHeader, bindRunButtons, loadAgent, loadReport, openFails } from './common.js';

export async function render(main, ctx) {
  const { agent, run } = await loadAgent(ctx.params[0]);
  const shown = await loadReport(agent, run);
  const src = await badgeSrc(agent.id);
  if (!ctx.alive()) return;
  const running = run && (run.status === 'queued' || run.status === 'running');
  const rep = shown?.report;
  const page = publicUrl.page(agent.id);
  const badge = publicUrl.badge(agent.id);
  const snippets = {
    md: `[![Loxe clearance](${badge})](${page})`,
    html: `<a href="${page}"><img src="${badge}" alt="Loxe clearance for ${agent.name}" height="24"></a>`,
  };
  const open = rep ? openFails(rep).length : 0;

  main.innerHTML = String(html`
    <section class="page">
      ${agentHeader(agent, 'share', running ? run : null)}
      ${!rep ? html`<div class="empty">${h1('Nothing to share yet.')}<p class="lede">The public page, badge and PDF appear after the first completed run.</p><div class="row" style="margin-top:var(--s5)"><button class="btn btn--primary" data-run-agent="${agent.id}" data-autofocus>Run clearance now</button></div></div>` : html`
      <div>
        ${h1('Evidence a buyer can check without asking you.')}
        <p class="lede">Send the page link in a security review. The grade, the date and the ledger head are on it, and the verify link recomputes the chain on the spot.</p>
      </div>
      <div class="split split--60">
        <div class="side">
          <div class="panel">
            <h2 class="h3">Public clearance page</h2>
            <p class="body">Anyone with the link can open it. It shows no headers, keys or transcripts.</p>
            <div class="copyfield"><input class="input" readonly value="${page}" aria-label="Public page URL"><button class="btn btn--primary" data-copy="${page}" data-copy-label="Page link copied" data-autofocus>Copy link</button></div>
            <div class="row" style="margin-top:var(--s3)"><a class="link" href="${page}" target="_blank" rel="noopener">Open the public page</a>${MOCK ? html`<span class="small">The backend serves this page; sample data has none.</span>` : ''}</div>
          </div>
          <div class="panel">
            <h2 class="h3">Badge</h2>
            <p class="body">It updates on every run, so it never shows a grade the agent no longer has.</p>
            <div class="badgebox" style="margin-top:var(--s3)"><a href="${page}" target="_blank" rel="noopener"><img src="${src}" alt="Loxe clearance badge for ${agent.name}" height="24"></a></div>
            <div style="margin-top:var(--s4)">
              <div class="seg" role="group" aria-label="Snippet format" id="fmt"><button type="button" data-v="md" aria-pressed="true">Markdown</button><button type="button" data-v="html" aria-pressed="false">HTML</button></div>
              <pre class="raw" id="snippet">${snippets.md}</pre>
              <button class="btn btn--s" id="copysnip" style="margin-top:var(--s2)">Copy snippet</button>
            </div>
          </div>
          <div class="panel">
            <h2 class="h3">PDF report</h2>
            <p class="body">The full report card with every finding in all three readings and the evidence appendix, for a procurement file.</p>
            <a class="btn" style="margin-top:var(--s3)" href="${publicUrl.pdf(rep.runId)}" target="_blank" rel="noopener">Download PDF</a>
          </div>
        </div>
        <aside class="panel">
          <h2 class="h3">What the page claims</h2>
          <p class="body">Loxe states one thing and it can be checked.</p>
          <ul class="claim">
            <li>${mark('pass', { size: 's' })}<span>${agent.name} was cleared against ${rep.total} probes in battery ${rep.libraryVersion} on ${day(rep.ts)}, at grade ${rep.grade}.</span></li>
            <li>${mark('pass', { size: 's' })}<span>Every result is in a hash-chained ledger anyone can recompute at <span class="mono">/verify</span>.</span></li>
            ${open ? html`<li>${mark('fail', { size: 's' })}<span>${cap(word(open))} open ${open === 1 ? 'gap is' : 'gaps are'} listed on the page. Nothing is hidden from a reader.</span></li>` : ''}
          </ul>
          <h3 class="h3" style="margin-top:var(--s5)">What it does not claim</h3>
          <ul class="claim">
            <li>${mark('off', { size: 's' })}<span>That the agent is certified, compliant or approved by any standards body.</span></li>
            <li>${mark('off', { size: 's' })}<span>That probes outside this battery would pass.</span></li>
            <li>${mark('off', { size: 's' })}<span>That a later build behaves the same. Turn on sentinel to keep the date fresh.</span></li>
          </ul>
          <a class="btn" style="margin-top:var(--s4)" href="#/agents/${agent.id}/monitor">Set up sentinel</a>
        </aside>
      </div>`}
    </section>`);
  bindRunButtons(main, ctx.go);
  let fmt = 'md';
  $$('#fmt button', main).forEach((b) => b.addEventListener('click', () => {
    fmt = b.dataset.v;
    $$('#fmt button', main).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    $('#snippet', main).textContent = snippets[fmt];
  }));
  $('#copysnip', main)?.addEventListener('click', () => import('../ui.js').then((u) => u.copy(snippets[fmt], 'Snippet copied')));
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
