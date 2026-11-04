// Guided demo. The owl walks through one full clearance in the demo workspace, step by step,
// explaining every hash, control mapping and decision with the real numbers on screen.
import { api } from './api.js';
import { html, raw, esc, short, word, SEV_RANK } from './ui.js';
import { setTour, say, repaint } from './owl.js';
import { TOUR_URL } from './mock.js';

const T = { i: 0, agentId: null, runId: null, run: null, top: null, entry0: null, go: null, leave: null };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForRun() {
  for (let n = 0; n < 120; n++) {
    T.run = await api.run(T.runId);
    if (T.run.status === 'completed' || T.run.status === 'failed') return T.run;
    say(`Waiting for the last probes: ${T.run.progress.done} of ${T.run.progress.total} done.`, { sticky: true });
    await sleep(1000);
  }
  return T.run;
}
const topFinding = () => [...(T.run?.report?.findings || [])].filter((f) => f.status === 'fail').sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0];
const FW = { soc2: 'SOC 2', 'owasp-llm': 'OWASP', 'nist-ai-rmf': 'NIST AI RMF', iso42001: 'ISO 42001' };

const STEPS = [
  {
    title: 'A full clearance in about three minutes.',
    body: () => html`<p>This is a demo workspace with sample agents. Nothing here touches your real agents, and leaving puts you back where you were.</p><p>I will add an agent, run the probes live, read the report three ways, verify the ledger, then share and monitor it. You can leave at any step.</p>`,
    route: () => '#/',
    next: 'Start',
  },
  {
    title: 'Step 1. Point Loxe at an agent.',
    body: () => html`<p>Loxe needs one thing: the URL your agent answers on. I filled in a sample helpdesk agent.</p><p>Loxe will send it 40 fixed messages in five categories. Each reply is checked by a fixed rule written in code. No model decides pass or fail, so the same build always gets the same grade.</p>`,
    route: () => `#/add?url=${encodeURIComponent(TOUR_URL)}&name=${encodeURIComponent('Northwind Helpdesk')}`,
    next: 'Add it and run the probes',
    async action() {
      say('Saving the agent, then queueing the battery of 40 probes.');
      const a = await api.createAgent({ name: 'Northwind Helpdesk', url: TOUR_URL, source: 'url' });
      T.agentId = a.id;
      const r = await api.startRun(a.id).catch((e) => (e.status === 409 ? { runId: e.body.runId } : Promise.reject(e)));
      T.runId = r.runId;
    },
  },
  {
    title: 'Step 2. Watch the probes run.',
    body: () => html`<p>Each square is one probe. The line under the title says which probe is going out and what it tries, for example a hidden instruction inside a product review.</p><p>Every result is hashed and appended to the ledger before the next probe starts, so the evidence exists before anyone has seen the grade.</p>`,
    route: () => `#/runs/${T.runId}`,
    next: 'Open the report card',
    async action() { await waitForRun(); T.top = topFinding(); say(''); },
  },
  {
    title: 'Step 3. Read the grade.',
    body: () => { const r = T.run.report; return html`<p>Graded <b>${r.grade}</b>: ${r.passed} of ${r.total} passed, ${r.failed} failed, ${r.inconclusive} could not be decided.</p><p>The grade is set by the worst open failure, here ${T.top ? `${T.top.probeId} at ${T.top.severity} severity` : 'none'}. Inconclusive probes never count against you, because Loxe does not guess.</p>`; },
    route: () => `#/agents/${T.agentId}/report`,
    next: 'Read one finding',
  },
  {
    title: 'Step 4. Plain English, for the buyer.',
    body: () => html`<p>${T.top.plainEnglish}</p><p>This view is for a founder or a buyer's reviewer. It says what happened, why it matters, and what to do, with no jargon.</p>`,
    route: () => `#/agents/${T.agentId}/report?finding=${T.top.probeId}&view=plain`,
    next: 'Now as an engineer',
  },
  {
    title: 'Step 5. Engineer, for the fix.',
    body: () => html`<p>The rule result is the pattern that matched: <code class="mono">${T.top.engineer.reason}</code>.</p><p>Below it are the raw detail, a patch you can copy, and a replay command. Replay sends the same probe again so you can confirm a fix before the next full run.</p>`,
    route: () => `#/agents/${T.agentId}/report?finding=${T.top.probeId}&view=engineer`,
    next: 'Now as an auditor',
  },
  {
    title: 'Step 6. Auditor, for the evidence.',
    body: () => { const ev = T.top.auditor.evidence; return html`<p>${T.top.probeId} is evidence for ${T.top.auditor.controls.map((c) => `${FW[c.framework] || c.framework} ${c.id}`).join(', ')}. Evidence for a control, not proof that the whole control is met.</p><p>It sits at ledger entry ${ev.ledgerSeq}. Its payload hash <code class="mono">${short(ev.hash, 12)}</code> covers the evidence; its entry hash <code class="mono">${short(ev.entryHash, 12)}</code> ties it to the entry before.</p>`; },
    route: () => `#/agents/${T.agentId}/report?finding=${T.top.probeId}&view=auditor`,
    next: 'Record a decision',
  },
  {
    title: 'Step 7. Decide, on the record.',
    body: () => html`<p>Three decisions are possible on a failing probe. <b>Fix proposed</b> says someone owns it. <b>Accept as an exception</b> says you accept the risk. <b>Resolved</b> is only a claim until a re-run proves it.</p><p>I will record "fix proposed" on ${T.top.probeId}. It becomes its own ledger entry with your name and the time, so nobody can quietly change it later.</p>`,
    route: () => `#/agents/${T.agentId}/report?finding=${T.top.probeId}&view=auditor`,
    next: 'Record it and verify the ledger',
    async action() {
      say(`Writing a decision on ${T.top.probeId} to the ledger.`);
      await api.decide(T.runId, T.top.probeId, 'fix_proposed', 'Demo: refund limit moved into the refund tool.');
      const l = await api.ledger(T.agentId);
      T.entries = l.entries;
      T.entry0 = l.entries[0];
    },
  },
  {
    title: 'Step 8. Check the ledger yourself.',
    body: () => { const e = T.entry0; return html`<p>Your browser is recomputing all ${T.entries.length} entries right now, including the decision you just recorded.</p><p>For entry 0 it hashes <code class="mono">{agentId, seq: 0, prevHash: ${short(e.prevHash, 8)}, payloadHash: ${short(e.payloadHash, 8)}}</code> with SHA-256 and gets <code class="mono">${short(e.entryHash, 12)}</code>. The first entry links to 64 zeros; every later one links to the one before, so editing any byte breaks everything after it.</p>`; },
    route: () => `#/agents/${T.agentId}/ledger?auto=1`,
    next: 'Share it',
  },
  {
    title: 'Step 9. Share a page a buyer can check.',
    body: () => html`<p>The public page shows the grade, the date, the open gaps and the ledger head. Its verify link recomputes the chain on the spot, no account needed.</p><p>It says the agent was cleared against these probes on this date. It never says certified, compliant or approved.</p>`,
    route: () => `#/agents/${T.agentId}/share`,
    next: 'What about the PDF',
  },
  {
    title: 'Step 10. The PDF for the procurement file.',
    body: () => html`<p>In your workspace, Download PDF returns the full report card: every finding in all three readings, the control mapping and the evidence appendix with hashes.</p><p>The demo has no server behind it, so there is no file here. Everything in the PDF is what you have just seen on screen.</p>`,
    route: () => `#/agents/${T.agentId}/share`,
    next: 'Keep it fresh',
  },
  {
    title: 'Step 11. Monitor, so the date never goes stale.',
    body: () => html`<p>Sentinel re-runs the same battery on a schedule and on every Maritime deploy. If the grade drops or the ledger stops verifying, Keiki messages the owner on Slack, iMessage, Telegram or email.</p><p>I will turn sentinel on for this agent, once a day.</p>`,
    route: () => `#/agents/${T.agentId}/monitor`,
    next: 'Turn it on',
    async action() { await api.sentinel(T.agentId, { enabled: true, intervalHours: 24 }); say('Sentinel is on. The next run is in 24 hours.'); },
  },
  {
    title: 'That is a full clearance.',
    body: () => html`<p>Added, probed, graded, read three ways, decided on the record, verified in your browser, shared and monitored.</p><p>Your own workspace has not changed. Test one of your real agents next; it takes a URL and one click.</p>`,
    route: () => `#/agents/${T.agentId}/monitor`,
    next: 'Leave the demo and test my agent',
    async action() { await T.leave({ firstAgent: true }); },
    last: true,
  },
];

async function goto(i) {
  T.i = Math.max(0, Math.min(STEPS.length - 1, i));
  repaint();
  T.go(STEPS[T.i].route());
}

export function startTour({ go, leave }) {
  Object.assign(T, { i: 0, agentId: null, runId: null, run: null, top: null, go, leave });
  setTour({
    render() {
      const s = STEPS[T.i];
      let body;
      try { body = s.body(); } catch { body = html`<p>Loading this step.</p>`; }
      return html`
        <div class="tourcard__meta small">Demo, step ${T.i + 1} of ${STEPS.length}</div>
        <div class="tourcard__bar"><span style="--p:${(T.i + 1) / STEPS.length}"></span></div>
        <h2 class="h3">${s.title}</h2>
        <div class="tourcard__body">${body}</div>
        <div class="row" style="margin-top:var(--s4)">
          <button class="btn btn--primary" type="button" data-tour="next">${s.next}</button>
          ${T.i > 0 && !s.last ? html`<button class="btn btn--quiet" type="button" data-tour="back">Back</button>` : ''}
          <button class="btn btn--quiet" type="button" data-tour="leave" style="margin-left:auto">Leave demo</button>
        </div>`;
    },
    bind(el) {
      el.querySelector('[data-tour="back"]')?.addEventListener('click', () => goto(T.i - 1));
      el.querySelector('[data-tour="leave"]')?.addEventListener('click', () => T.leave());
      const next = el.querySelector('[data-tour="next"]');
      next?.addEventListener('click', async () => {
        const s = STEPS[T.i];
        next.classList.add('is-busy');
        next.disabled = true;
        try {
          if (s.action) await s.action();
          if (!s.last) await goto(T.i + 1);
        } catch (e) {
          say(`That step did not work: ${e.message}`);
          next.classList.remove('is-busy');
          next.disabled = false;
        }
      });
    },
  });
  goto(0);
}

export function stopTour() { setTour(null); }
