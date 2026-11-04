#!/usr/bin/env node
// LOXE CLI — the developer surface over the same API the web app uses.
//   LOXE_BASE_URL=https://… LOXE_API_KEY=lx_… loxe <command>
//   loxe clear <url> [--name n]      register an endpoint and run a clearance, wait for the grade
//   loxe run <agent-id> [--min-grade B]  re-run; exit 3 if the grade is worse than B (for CI)
//   loxe run <agent-id>              re-run an existing agent
//   loxe agents                      list agents and grades
//   loxe report <run-id> [--json]    print the report card (findings by severity)
//   loxe verify <agent-id> [--offline]  recompute the ledger (offline: download and check locally)
//   loxe hash <sha256>               look a report hash up in the ledger
//   loxe replay <run-id> <probe-id>  re-run one probe and compare with the recorded verdict
//   loxe monitor <agent-id> <hours|off>  turn the sentinel on or off
import { createHash } from 'node:crypto';

// Self-contained on purpose: this file is also served at https://loxeagent.loxeai.com/cli/loxe.mjs,
// so the offline check must not depend on the Loxe server code. Mirrors src/core + src/ledger.
const canonicalize = (v) => {
  if (v === null || typeof v !== 'object') return typeof v === 'number' && !Number.isFinite(v) ? 'null' : JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map((x) => (x === undefined ? 'null' : canonicalize(x))).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalize(v[k])).join(',') + '}';
};
const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const GENESIS = '0'.repeat(64);
function verifyRows(agentId, rows) {
  let prev = GENESIS;
  for (const [i, r] of rows.entries()) {
    const bad = (error) => ({ valid: false, length: rows.length, error });
    if (r.seq !== i) return bad(`seq ${r.seq}: expected ${i}`);
    if (r.prev_hash !== prev) return bad(`seq ${r.seq}: prev_hash does not match the entry before it`);
    if (sha256(typeof r.payload === 'string' ? r.payload : canonicalize(r.payload)) !== r.payload_hash) return bad(`seq ${r.seq}: payload does not match its hash`);
    if (sha256(canonicalize({ agentId, seq: r.seq, prevHash: r.prev_hash, payloadHash: r.payload_hash })) !== r.entry_hash) return bad(`seq ${r.seq}: entry hash does not recompute`);
    prev = r.entry_hash;
  }
  return { valid: true, length: rows.length, head: rows.length ? prev : null };
}

const BASE = (process.env.LOXE_BASE_URL || 'https://loxeagent.loxeai.com').replace(/\/$/, '');
const KEY = process.env.LOXE_API_KEY;
const [cmd, ...args] = process.argv.slice(2);
const flag = (f) => args.includes(f);
const opt = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);

async function api(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(KEY ? { authorization: `Bearer ${KEY}` } : {}),
      ...(process.env.GITHUB_ACTIONS === 'true' ? { 'x-loxe-trigger': 'ci:github' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new Error(`${res.status} ${data.error || data}`);
  return data;
}

const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
function printReport(r) {
  console.log(`\nGrade ${r.grade}  ${r.gradeSummary}`);
  console.log(`${r.passed} held, ${r.failed} gaps, ${r.inconclusive} untested  (library ${r.libraryVersion})`);
  console.log(`Ledger ${r.ledger.valid ? 'verifies' : 'DOES NOT verify'}: ${r.ledger.length} entries, head ${r.ledger.head}`);
  const gaps = r.findings.filter((f) => f.status === 'fail').sort((a, b) => SEV[b.severity] - SEV[a.severity]);
  for (const f of gaps) {
    console.log(`\n  ${f.severity.toUpperCase().padEnd(8)} ${f.probeId}  ${f.title}`);
    console.log(`           ${f.plainEnglish}`);
    if (f.engineer.remediation) console.log(`           fix: ${f.engineer.remediation.summary}`);
    console.log(`           ${f.auditor.controls.map((c) => `${c.framework}:${c.id}`).join('  ')}`);
  }
  console.log(`\nPublic page: ${BASE}/a/${r.agentId}\nPDF: ${BASE}/report/${r.runId}/pdf`);
}

async function waitFor(runId) {
  let last = '';
  for (;;) {
    const run = await api('GET', `/api/runs/${runId}`);
    const line = run.progress ? `${run.status} ${run.progress.done}/${run.progress.total} ${run.progress.current || ''}` : run.status;
    if (line !== last) process.stderr.write(`\r${line.padEnd(40)}`), (last = line);
    if (run.status === 'completed') return process.stderr.write('\n'), run;
    if (run.status === 'failed') throw new Error(`run failed: ${run.error}`);
    await new Promise((r) => setTimeout(r, 1000));
  }
}

// --min-grade B: exit 3 when the grade is worse than B. In GitHub Actions, also write the job
// summary and one error annotation per open gap.
async function gate(r) {
  const min = (opt('--min-grade') || process.env.LOXE_MIN_GRADE || '').toUpperCase();
  if (min && !/^[A-F]$/.test(min)) throw new Error('--min-grade must be a letter A to F');
  const below = min && r.grade > min;
  if (process.env.GITHUB_ACTIONS === 'true') {
    const gaps = r.findings.filter((f) => f.status === 'fail').sort((a, b) => SEV[b.severity] - SEV[a.severity]);
    for (const f of gaps.slice(0, 10)) console.log(`::${SEV[f.severity] >= 3 ? 'error' : 'warning'} title=Loxe ${f.probeId} (${f.severity})::${f.title}. ${f.plainEnglish}`.replace(/\r?\n/g, ' '));
    if (process.env.GITHUB_STEP_SUMMARY) {
      const { appendFileSync } = await import('node:fs');
      const rows = gaps.map((f) => `| ${f.severity} | ${f.probeId} | ${f.title} | ${f.engineer.remediation?.summary || ''} |`).join('\n');
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, [
        `## Loxe: grade ${r.grade}${min ? (below ? ` (below the minimum ${min})` : ` (meets the minimum ${min})`) : ''}`,
        `${r.passed} held, ${r.failed} gaps, ${r.inconclusive} untested. Ledger ${r.ledger.valid ? 'verifies' : 'does NOT verify'}.`,
        gaps.length ? `\n| Severity | Probe | Gap | Fix |\n|---|---|---|---|\n${rows}` : '',
        `\n[Public page](${BASE}/a/${r.agentId}), [PDF](${BASE}/report/${r.runId}/pdf)\n`,
      ].join('\n'));
    }
  }
  if (below) {
    console.error(`Grade ${r.grade} is below the minimum ${min}.`);
    process.exitCode = 3;
  }
}

const commands = {
  async clear() {
    const url = args.find((a) => /^https?:\/\//.test(a));
    if (!url) throw new Error('usage: loxe clear <url> [--name name]');
    const agent = await api('POST', '/api/agents', { name: opt('--name') || new URL(url).host, url });
    console.log(`Registered ${agent.name} as ${agent.id}`);
    const { runId } = await api('POST', `/api/agents/${agent.id}/runs`);
    const { report } = await waitFor(runId);
    printReport(report);
    await gate(report);
  },
  async run() {
    const { runId } = await api('POST', `/api/agents/${args[0]}/runs`);
    const { report } = await waitFor(runId);
    printReport(report);
    await gate(report);
  },
  async agents() {
    for (const a of await api('GET', '/api/agents'))
      console.log(`${(a.grade || '-').padEnd(3)} ${a.id}  ${a.name}  ${a.chain.valid ? 'ledger ok' : 'LEDGER BROKEN'}  ${a.sentinel.enabled ? `monitor ${a.sentinel.intervalHours}h` : ''}`);
  },
  async report() {
    const run = await api('GET', `/api/runs/${args[0]}`);
    flag('--json') ? console.log(JSON.stringify(run.report, null, 2)) : printReport(run.report);
  },
  async verify() {
    if (flag('--offline')) {
      const exp = await api('GET', `/ledger/${args[0]}/export`);
      const r = verifyRows(exp.agentId, exp.entries);
      console.log(r.valid ? `Verified locally: ${r.length} entries, head ${r.head}` : `NOT valid: ${r.error}`);
      process.exitCode = r.valid ? 0 : 2;
    } else {
      console.log(await api('GET', `/verify/${args[0]}`));
    }
  },
  async hash() {
    console.log(await api('GET', `/verify?hash=${args[0]}`));
  },
  async replay() {
    const r = await api('POST', `/api/runs/${args[0]}/replay/${args[1]}`);
    console.log(`${r.probeId}: recorded ${r.original?.status}, now ${r.now.status}. ${r.same ? 'Same verdict.' : 'VERDICT CHANGED.'}`);
  },
  async monitor() {
    const off = args[1] === 'off';
    console.log(await api('POST', `/api/agents/${args[0]}/sentinel`, { enabled: !off, intervalHours: off ? undefined : Number(args[1] || 24) }));
  },
};

if (!commands[cmd]) {
  console.log('loxe clear <url> | run <agent> [--min-grade B] | agents | report <run> | verify <agent> [--offline] | hash <sha256> | replay <run> <probe> | monitor <agent> <hours|off>');
  process.exit(cmd ? 1 : 0);
}
commands[cmd]().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
