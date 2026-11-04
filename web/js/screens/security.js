// Security: what Loxe touches, what a report contains, who sees what, why the proof is safe.
import { html, $$ } from '../ui.js';
import { setContext } from '../owl.js';

const REACH = [
  ['Sends chat messages to the endpoint you paste.', 'Log into your cloud, read your code or change your config.'],
  ['Uses the one auth header you add for that endpoint, if any.', 'Show that header back, put it in a report, or send it anywhere else.'],
  ['Reads public metadata at /.well-known/agent.json if you publish it.', 'Crawl other paths, follow redirects, or reach private or internal addresses.'],
];
const INCLUDED = [
  'Agent name and ID',
  'Grade and the counts',
  'For each probe: ID, version, area, severity, pass, fail or not decided, the rule that decided it, and which test pattern matched',
  'Framework controls',
  'SHA-256 hashes of the evidence, the entry and the transcript',
  'Probe library version and hash',
  'Date',
  'The Ed25519 signature',
];
const KEPT_OUT = [
  'Your agent\'s replies (only their hash is in the report)',
  'Your endpoint URL',
  'Your auth header',
  'Who recorded a decision and their note (only the decision state and date)',
  'Anything from your other agents or your organization',
];
const WHO = [
  ['Anyone with your share link', 'Grade, findings, framework mapping, hashes and the PDF. The link is off until you turn it on.'],
  ['Your organization', 'Everything above, plus raw transcripts, decision notes and their authors, the endpoint URL and run history.'],
  ['Loxe', 'Stores it to run the service. Auth headers are encrypted at rest. Supermemory keeps run history and decision states, never your notes or transcripts.'],
];
const PROOF = [
  'Code decides every verdict. No model judges pass or fail.',
  'Each result is hashed with SHA-256, a one-way fingerprint: it proves the result without revealing the agent\'s replies.',
  'Every entry includes the hash before it, so editing or deleting one breaks every entry after it.',
  'After each run Loxe signs the latest hash with Ed25519. Anyone can check the signature with our public key.',
  'The database refuses edits to the ledger. Even Loxe cannot rewrite history without the chain showing it.',
];
const CONTROL = [
  ['Export', 'Download any agent\'s full ledger and verify it on your own machine.'],
  ['Share', 'Each agent starts private. Turn its public page and PDF on or off from its Share tab.'],
  ['Delete', 'Deleting an agent removes its transcripts, decision notes and stored auth header. Its hashes stay so past reports still verify.'],
  ['Keys', 'Create and revoke API keys on the Connect page. Keys are stored as hashes; we show each one once.'],
];

export async function render(main, ctx) {
  setContext({ route: 'security' }, ['What does Loxe send to my agent?', 'Is my auth header stored?', 'Can Loxe change the ledger?']);
  main.innerHTML = String(html`
    <article class="why sec">
      <header class="why__hero">
        <h1 class="h1 h1--sans why__h1">What Loxe touches, and what it never does.</h1>
        <p class="why__line">Loxe is read-only toward your systems. It sends test messages to one URL you choose and records what comes back.</p>
      </header>

      <section class="why__sec">
        <h2 class="h2">What Loxe can reach</h2>
        <div class="vs" role="table" aria-label="What Loxe does and never does">
          <div class="vs__row vs__head" role="row"><span role="columnheader">Loxe does</span><span role="columnheader">Loxe never does</span></div>
          ${REACH.map(([a, b]) => html`<div class="vs__row vs__row--sec" role="row"><span class="vs__us" role="cell">${a}</span><span class="vs__never" role="cell">${b}</span></div>`)}
        </div>
        <div class="warn" role="note">
          <span class="mark mark--fail" aria-hidden="true"></span>
          <div><b>Test a staging agent.</b> Some probes ask your agent to delete records, refund money or send email. If your agent obeys, it really does it, so point Loxe at a sandbox with fake data.</div>
        </div>
      </section>

      <section class="why__sec">
        <h2 class="h2">What goes into a report</h2>
        <div class="inout">
          <div><h3 class="h3">Included</h3><ul class="inout__list">${INCLUDED.map((x) => html`<li>${x}</li>`)}</ul></div>
          <div><h3 class="h3">Kept out</h3><ul class="inout__list inout__list--out">${KEPT_OUT.map((x) => html`<li>${x}</li>`)}</ul></div>
        </div>
      </section>

      <section class="why__sec">
        <h2 class="h2">Who sees what</h2>
        <div class="tbl3" role="table" aria-label="Who sees what">
          ${WHO.map(([w, l]) => html`<div class="tbl3__row" role="row"><span class="tbl3__who" role="rowheader">${w}</span><span role="cell">${l}</span></div>`)}
        </div>
      </section>

      <section class="why__sec">
        <h2 class="h2">How the proof works, and why it is safe</h2>
        <ol class="steps steps--wide">${PROOF.map((s, i) => html`<li><span class="steps__n">${i + 1}</span><span>${s}</span></li>`)}</ol>
        <button class="linkbtn" type="button" data-sec="ledger" style="margin-top:var(--s5)">Verify a real ledger</button>
      </section>

      <section class="why__sec why__end">
        <h2 class="h2">You stay in control</h2>
        <div class="tbl3">${CONTROL.map(([w, l]) => html`<div class="tbl3__row"><span class="tbl3__who">${w}</span><span>${l}</span></div>`)}</div>
      </section>
    </article>`);
  $$('[data-sec="ledger"]', main).forEach((b) => b.addEventListener('click', async () => (await import('../app.js')).openDemoLedger()));
}
