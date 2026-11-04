// Why Loxe: what it is, how it differs from a pen test, who it is for, how the proof works.
import { html, raw, $, $$, short } from '../ui.js';
import { GENESIS, entryHash, hashObject } from '../canonical.js';
import { setContext } from '../owl.js';

const ROWS = [
  ['Ends in a PDF that is stale after the next deploy.', 'Re-tests on every deploy and on a schedule, and tells you when the grade moves.'],
  ['The evidence is the tester\'s word.', 'The evidence is hashed, chained and signed. Anyone can re-run it and get the same verdict.'],
  ['Written for engineers.', 'Every finding is written three ways: plain English for the buyer, the fix for the engineer, the control for the auditor.'],
  ['Says what broke.', 'Maps every result to SOC 2, ISO 42001, NIST AI RMF and OWASP LLM Top 10, so it drops into an audit.'],
];
const WHO = [
  ['Agent vendors', 'Send a clearance page with the first email instead of a 200-row security questionnaire.'],
  ['Buyers and security leads', 'Get a yes or no with evidence, in minutes, for any agent a vendor sends you.'],
  ['Engineers', 'See the input that broke the agent, why it matters, and the patch.'],
  ['Auditors and vCISOs', 'Cite control-mapped, hashed evidence in a workpaper.'],
  ['Agent platforms', 'Show a clearance badge on every agent deployed on you.'],
];
const STEPS = [
  '40 frozen tests across data exposure, tool permissions, prompt injection, harmful actions and hygiene.',
  'Code decides pass or fail. A model never does.',
  'Each result is SHA-256 hashed and chained to the one before, so changing any entry breaks every entry after it.',
  'The chain head is signed with Ed25519. Paste any hash from a report and check it yourself.',
];

export async function render(main, ctx) {
  setContext({ route: 'why' }, ['How is this different from a pen test?', 'What is SHA-256 doing here?', 'Is this a certification?']);
  const chain = await sampleChain();
  const signedIn = !!ctx.session.user;
  main.innerHTML = String(html`
    <article class="why">
      <header class="why__hero">
        <h1 class="h1 h1--sans why__h1">Proof your AI agent is safe to let in.</h1>
        <p class="why__line">Loxe tests any AI agent, grades it A to F, and records every result in a ledger nobody can quietly edit. Not even us.</p>
        <div class="row row--l why__cta">
          <a class="btn btn--primary btn--l" href="${signedIn ? '#/add' : '#/signin?next=%23%2Fadd'}" data-autofocus>Test my agent</a>
          <button class="btn btn--l" type="button" data-why="demo">Watch the demo</button>
        </div>
      </header>

      <section class="why__sec">
        <h2 class="h2">This is not a pen test.</h2>
        <div class="vs" role="table" aria-label="A pen test compared with Loxe">
          <div class="vs__row vs__head" role="row"><span role="columnheader">A pen test</span><span role="columnheader">Loxe</span></div>
          ${ROWS.map(([a, b]) => html`<div class="vs__row" role="row"><span class="vs__them" role="cell">${a}</span><span class="vs__us" role="cell">${b}</span></div>`)}
        </div>
        <p class="why__close">A pen test finds holes once. Loxe is the running record of what your agent is allowed to do and what it did under pressure.</p>
      </section>

      <section class="why__sec">
        <h2 class="h2">Who it's for</h2>
        <ol class="wholist">
          ${WHO.map(([w, l], i) => html`<li class="who__row ${i === 0 ? 'who__row--lead' : ''}"><span class="who__n">${i + 1}</span><span class="who__w">${w}</span><span class="who__l">${l}</span></li>`)}
        </ol>
      </section>

      <section class="why__sec why__proof">
        <div>
          <h2 class="h2">How the proof works</h2>
          <ol class="steps">${STEPS.map((s, i) => html`<li><span class="steps__n">${i + 1}</span><span>${s}</span></li>`)}</ol>
          <div class="row row--l" style="margin-top:var(--s5)"><button class="linkbtn" type="button" data-why="ledger">Verify a real ledger</button><a class="link" href="#/security">How we handle your data</a></div>
        </div>
        <figure class="chainfig" aria-label="Three ledger entries, each linked to the one before">
          ${chain.map((e, i) => html`
            ${i ? html`<div class="chainfig__link" aria-hidden="true"><span></span></div>` : ''}
            <div class="chainfig__entry" style="animation-delay:${i * 160}ms">
              <div class="chainfig__top"><span class="mark mark--pass mark--s" aria-hidden="true"></span><span>Entry ${e.seq}</span><span class="small">${e.label}</span></div>
              <dl>
                <dt>prev</dt><dd>${short(e.prevHash, 16)}</dd>
                <dt>evidence</dt><dd>${short(e.payloadHash, 16)}</dd>
                <dt>entry</dt><dd class="t-proven">${short(e.entryHash, 16)}</dd>
              </dl>
            </div>`)}
          <figcaption class="hint">Real SHA-256, computed in your browser just now.</figcaption>
        </figure>
      </section>

      <section class="why__end">
        <h2 class="h1 h1--sans why__h1">Trust in an agent becomes portable.</h2>
        <p class="why__line">Clear an agent once. The proof follows it to the next buyer, the next audit and the next platform.</p>
        <a class="btn btn--primary btn--l" href="${signedIn ? '#/add' : '#/signin?next=%23%2Fadd'}">Test my agent</a>
      </section>
    </article>`);

  $$('[data-why]', main).forEach((b) => b.addEventListener('click', async () => {
    const app = await import('../app.js');
    if (b.dataset.why === 'demo') app.enterDemo();
    else app.openDemoLedger();
  }));
}

// Three entries chained the same way the server chains them.
async function sampleChain() {
  const agentId = 'agent-why-sample';
  const items = [['OH-01', 'Encrypted transport'], ['PI-02', 'Indirect injection'], ['TP-03', 'No data exfiltration']];
  const out = [];
  let prevHash = GENESIS;
  for (let seq = 0; seq < items.length; seq++) {
    const payloadHash = await hashObject({ probeId: items[seq][0], status: 'pass', seq });
    const eh = await entryHash({ agentId, seq, prevHash, payloadHash });
    out.push({ seq, prevHash, payloadHash, entryHash: eh, label: `${items[seq][0]} ${items[seq][1]}` });
    prevHash = eh;
  }
  return out;
}
