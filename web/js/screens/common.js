// Shared pieces for agent screens: header with tabs, attention ranking, run starts.
import { api } from '../api.js';
import { html, raw, esc, word, Word, plural, ago, isStale, SEV_RANK, seal, toast } from '../ui.js';

export const openFails = (report) =>
  (report?.findings || []).filter((f) => f.status === 'fail' && (!f.decision || f.decision.state === 'open'))
    .sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity]);

export function severityCounts(list) {
  const c = { critical: 0, high: 0, medium: 0, low: 0 };
  list.forEach((f) => { c[f.severity]++; });
  return ['critical', 'high', 'medium', 'low'].filter((s) => c[s]).map((s) => `${word(c[s])} ${s}`);
}
export const joinList = (parts) => parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;

// Decide what an agent needs from the user, and how urgent it is.
// The rule, in order: broken ledger, stopped run, open critical/high gaps, never run, stale, other gaps, running.
export function attention(agent, run) {
  const report = run?.status === 'completed' ? run.report : null;
  const name = agent.name;
  const base = { agent, run };
  if (agent.chain && agent.chain.valid === false) {
    return { ...base, score: 100, state: 'broken', headline: `${name}'s ledger does not verify.`, why: 'An entry changed after it was written. Every result after it is unproven until you find out why.', short: 'Ledger does not verify', action: { label: 'Open the ledger trace', href: `#/agents/${agent.id}/ledger` } };
  }
  if (run?.status === 'failed') {
    return { ...base, score: 90, state: 'fail', headline: `${name}'s last run stopped.`, why: run.error || 'The run ended without a grade.', short: 'Last run stopped', action: { label: 'Run it again', run: agent.id } };
  }
  const fails = openFails(report);
  const serious = fails.filter((f) => SEV_RANK[f.severity] >= 3);
  if (serious.length) {
    const worst = fails[0];
    return { ...base, score: 70 + SEV_RANK[worst.severity] * 2 + fails.length / 100, state: 'fail', headline: `Fix ${name} first.`, why: worst.plainEnglish, rule: `Graded ${report.grade}. ${Word(fails.length)} open ${plural(fails.length, 'gap')}: ${joinList(severityCounts(fails))}.`, short: `${Word(fails.length)} open ${plural(fails.length, 'gap')}, worst is ${worst.severity}`, action: { label: `Fix the ${worst.severity} gap`, href: `#/agents/${agent.id}/report?finding=${encodeURIComponent(worst.probeId)}` }, finding: worst };
  }
  if (run?.status === 'awaiting_replies') {
    return { ...base, score: 40, state: 'pending', headline: `Finish testing ${name}.`, why: `${Word(run.progress.done)} of ${run.progress.total} replies pasted. They are saved, so pick up where you left off.`, short: `${run.progress.done} of ${run.progress.total} replies pasted`, action: { label: 'Continue the test', href: `#/runs/${run.id}` } };
  }
  if (!agent.lastRunId && agent.source === 'hand') {
    return { ...base, score: 60, state: 'pending', headline: `Test ${name} by hand.`, why: `Loxe gives you each test message to send it in ${agent.where}, and you paste the replies back.`, short: 'Not tested yet', action: { label: 'Start the test', run: agent.id } };
  }
  if (!agent.lastRunId) {
    return { ...base, score: 60, state: 'pending', headline: `Clear ${name} for the first time.`, why: `It was added ${ago(agent.createdAt)} and has never been probed. The battery takes about a minute.`, short: 'Never probed', action: { label: 'Run clearance now', run: agent.id } };
  }
  if (run && (run.status === 'queued' || run.status === 'running')) {
    return { ...base, score: 20, state: 'running', headline: `${name} is being probed.`, why: run.status === 'queued' ? 'The run is queued. Probes start in a moment.' : `${run.progress.done} of ${run.progress.total} probes done. You can leave this page; the run keeps going.`, short: run.status === 'queued' ? 'Queued' : `Running, ${run.progress.done} of ${run.progress.total}`, action: { label: 'Watch the run', href: `#/runs/${run.id}` } };
  }
  if (isStale(agent)) {
    return { ...base, score: 50, state: 'stale', headline: `Re-clear ${name}.`, why: `Its last clearance is ${ago(agent.lastRunAt).replace(' ago', '')} old and sentinel is off, so anyone checking sees an old date.`, short: `Last cleared ${ago(agent.lastRunAt)}`, action: { label: 'Re-run now', run: agent.id } };
  }
  if (fails.length) {
    const worst = fails[0];
    return { ...base, score: 30 + SEV_RANK[worst.severity] * 2, state: 'fail', headline: `Close the gaps in ${name}.`, why: worst.plainEnglish, rule: `Graded ${report.grade}. ${Word(fails.length)} open ${plural(fails.length, 'gap')}: ${joinList(severityCounts(fails))}.`, short: `${Word(fails.length)} open ${plural(fails.length, 'gap')}`, action: { label: 'Open the report', href: `#/agents/${agent.id}/report?finding=${encodeURIComponent(worst.probeId)}` }, finding: worst };
  }
  return { ...base, score: 0, state: 'pass', headline: `${name} is cleared.`, why: 'Every probe passed or is decided.', short: `Cleared ${ago(agent.lastRunAt)}`, action: { label: 'Open the report', href: `#/agents/${agent.id}/report` } };
}

export async function startRun(agentId, go, btn) {
  if (btn) { btn.classList.add('is-busy'); btn.disabled = true; }
  try {
    const r = await api.startRun(agentId);
    go(`#/runs/${r.runId}`);
  } catch (e) {
    if (e.status === 409 && e.body?.runId) { go(`#/runs/${e.body.runId}`); return; }
    toast(`Could not start the run: ${e.message}`, 'gap');
    if (btn) { btn.classList.remove('is-busy'); btn.disabled = false; }
  }
}

export function agentHeader(agent, active, run, { seal: showSeal = true } = {}) {
  const running = run && (run.status === 'queued' || run.status === 'running' || run.status === 'awaiting_replies');
  const liveLabel = run?.status === 'awaiting_replies' ? 'Continue the test' : 'Watch the run';
  const tabs = [
    ['report', 'Report'],
    ['ledger', 'Ledger'],
    ['share', 'Share'],
    ['monitor', 'Monitor'],
  ];
  return html`
    <div>
      <a class="crumb" href="#/">All agents</a>
      <div class="agenthead" style="margin-top:var(--s3)">
        <div style="display:flex;gap:var(--s4);align-items:center;min-width:0">
          ${showSeal ? seal(agent.grade, { size: 'm', stale: isStale(agent), running }) : ''}
          <div style="min-width:0">
            <h2 class="h2">${agent.name}</h2>
            <div class="agenthead__url">${agent.source === 'hand' ? `Tested by hand, ${agent.where}` : agent.url}</div>
          </div>
        </div>
        <div class="row">
          ${running && active === 'run' ? '' : running ? html`<a class="btn" href="#/runs/${run.id}"><span class="mark mark--running mark--s" aria-hidden="true"></span>${liveLabel}</a>` : html`<button class="btn" data-run-agent="${agent.id}">${agent.source === 'hand' ? (agent.lastRunId ? 'Test again by hand' : 'Start the test') : agent.lastRunId ? 'Re-run clearance' : 'Run clearance'}</button>`}
        </div>
      </div>
      <nav class="tabs" aria-label="${agent.name}">
        ${tabs.map(([k, l]) => html`<a href="#/agents/${agent.id}/${k}" ${raw(active === k ? 'aria-current="page"' : '')}>${l}</a>`)}
        ${running ? html`<a href="#/runs/${run.id}" ${raw(active === 'run' ? 'aria-current="page"' : '')}><span class="mark mark--running mark--s" aria-hidden="true"></span>${run.status === 'awaiting_replies' ? 'Test in progress' : 'Live run'}</a>` : ''}
      </nav>
    </div>`;
}

export function bindRunButtons(root, go) {
  root.querySelectorAll('[data-run-agent]').forEach((b) => b.addEventListener('click', () => startRun(b.dataset.runAgent, go, b)));
}

// Load an agent and its latest run together.
export async function loadAgent(id) {
  const agent = await api.agent(id);
  const run = agent.lastRunId ? await api.run(agent.lastRunId).catch(() => null) : null;
  return { agent, run };
}

// Latest completed report for an agent. If the newest run is still going, fall back to the last completed one.
export async function loadReport(agent, run, runIdOverride) {
  if (runIdOverride) return api.run(runIdOverride);
  if (run?.status === 'completed') return run;
  const list = await api.runs(agent.id).catch(() => []);
  const done = list.find((r) => r.status === 'completed');
  return done ? api.run(done.id) : null;
}
