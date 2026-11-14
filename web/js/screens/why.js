// Why Loxe: what it is, how it differs from a pen test, who it is for, how the proof works.
import { html, raw, $, $$, short } from '../ui.js';
import { GENESIS, entryHash, hashObject } from '../canonical.js';
import { setContext } from '../owl.js';

const ROWS = [
  ['Weeks to book and thousands of dollars.', 'About a minute. Free.'],
  ['A PDF that goes stale the next time you ship.', 'Re-run it on every release, or let it re-check on a schedule. You hear about it when the grade moves.'],
  ["The evidence is the tester's word.", 'Every result is hashed, chained and signed. Anyone can re-run the tests and get the same verdict.'],
  ['Written for engineers.', 'Each finding comes three ways: plain English for the buyer, the fix for your engineer, the control ID for the auditor.'],
  ['Says what broke.', 'Maps every result to SOC 2, ISO 42001, NIST AI RMF and OWASP LLM Top 10, so it drops straight into an audit.'],
];
const WHO = [
  ['Agent vendors', 'Send a clearance link with your first email and skip most of the 200-row security questionnaire.'],
  ['Buyers and security leads', "A vendor swears their agent is safe? Check it yourself in a minute, with evidence you can forward."],
  ['Engineers', 'See the exact message that broke your agent, why it matters, and the patch.'],
  ['Auditors and vCISOs', "Cite hashed, control-mapped evidence in a workpaper without taking anyone's word for it."],
  ['Agent platforms', 'Put a clearance badge on every agent that ships on your platform.'],
];
const STEPS = [
  '40 fixed attacks: leaking data, abusing tools, prompt injection, harmful actions and basic hygiene.',
  'Plain code decides pass or fail. No model grades another model.',
  'Every result is SHA-256 hashed and chained to the one before, so editing one entry breaks every entry after it.',
  'The chain head is signed with Ed25519. Paste any hash from a report and check it yourself.',
];

export async function render(main, ctx) {
  setContext({ route: 'why' }, ['How is this different from a pen test?', 'What is SHA-256 doing here?', 'Is this a certification?']);
  const chain = await sampleChain();
  const signedIn = !!ctx.session.user;
  main.innerHTML = String(html`
    <article class="why">
      <header class="why__hero">
        <h1 class="h1 h1--sans why__h1">Your AI agent says it's safe. Make it prove it.</h1>
        <p class="why__line">Loxe throws 40 attacks at your agent, grades it A to F, and writes every result into a ledger nobody can quietly edit. Including us.</p>
        <p class="body why__where">OpenAI, Claude, LangChain, Vercel, something you duct-taped together last weekend. If it answers chat messages at a URL, Loxe can test it. If it doesn't, you can test it by hand.</p>
        <div class="row row--l why__cta">
          <a class="btn btn--primary btn--l" href="${signedIn ? '#/add' : '#/signin?next=%23%2Fadd'}" data-autofocus>Test my agent</a>
          <button class="btn btn--l" type="button" data-why="demo">Watch the demo</button>
        </div>
      </header>

      <section class="why__sec">
        <h2 class="h2">Why not just get a pen test?</h2>
        <div class="vs" role="table" aria-label="A pen test compared with Loxe">
          <div class="vs__row vs__head" role="row"><span role="columnheader">A pen test</span><span role="columnheader">Loxe</span></div>
          ${ROWS.map(([a, b]) => html`<div class="vs__row" role="row"><span class="vs__them" role="cell">${a}</span><span class="vs__us" role="cell">${b}</span></div>`)}
        </div>
        <p class="why__close">Get one if a customer asks for it. A pen test finds holes once, though. Loxe keeps a running record of what your agent did every time someone leaned on it.</p>
      </section>

      <section class="why__sec">
        <h2 class="h2">Who it's for</h2>
        <ol class="wholist">
          ${WHO.map(([w, l], i) => html`<li class="who__row ${i === 0 ? 'who__row--lead' : ''}"><span class="who__n">${i + 1}</span><span class="who__w">${w}</span><span class="who__l">${l}</span></li>`)}
        </ol>
      </section>

      <section class="why__sec why__proof">
        <div>
          <h2 class="h2">How the proof works (no blockchain, promise)</h2>
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
        <h2 class="h1 h1--sans why__h1">A grade that travels with your agent.</h2>
        <p class="why__line">Test it once and the proof goes with it, to the next buyer and the next audit. When you ship a fix, run it again and watch the letter change.</p>
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
