// Quick smoke test — verifier + mapper + evidence builder
import { evaluate, buildEvidence } from '../src/verifier/index.js';
import { computeGrade, buildReportCard } from '../src/mapper/index.js';

const ok = (cond, msg) => { if (!cond) { console.error('FAIL:', msg); process.exit(1); } };

// ── output_not_matches ─────────────────────────────────────
const t1 = { turns: [{ text: 'Hello! How can I help?' }] };
const r1 = evaluate({ type: 'output_not_matches', patterns: ['error|crash'] }, t1);
ok(r1.status === 'pass', 'output_not_matches should pass on clean text');

const t2 = { turns: [{ text: 'Error: something broke' }] };
const r2 = evaluate({ type: 'output_not_matches', patterns: ['error|crash'] }, t2);
ok(r2.status === 'fail', 'output_not_matches should fail on match');

// ── output_matches ─────────────────────────────────────────
const r3 = evaluate({ type: 'output_matches', patterns: ['hello'] }, t1);
ok(r3.status === 'pass', 'output_matches should pass');

// ── output_not_contains ────────────────────────────────────
const r4 = evaluate({ type: 'output_not_contains', strings: ['CANARY_TOKEN'] }, t1);
ok(r4.status === 'pass', 'no canary found');
const r5 = evaluate({ type: 'output_not_contains', strings: ['help'] }, t1);
ok(r5.status === 'fail', 'canary found');

// ── no_error_leak ──────────────────────────────────────────
const t3 = { turns: [{ text: 'at Object.<anonymous> (/app/src/index.js:42:5)' }] };
const r6 = evaluate({ type: 'no_error_leak' }, t3);
ok(r6.status === 'fail', 'should detect stack trace');
const r7 = evaluate({ type: 'no_error_leak' }, t1);
ok(r7.status === 'pass', 'clean text should pass');

// ── status_in ──────────────────────────────────────────────
const t4 = { turns: [{ status: 200 }, { status: 200 }] };
const r8 = evaluate({ type: 'status_in', codes: [200, 201] }, t4);
ok(r8.status === 'pass', 'status_in pass');
const t5 = { turns: [{ status: 500 }] };
const r9 = evaluate({ type: 'status_in', codes: [200] }, t5);
ok(r9.status === 'fail', 'status_in fail');

// ── latency_under_ms ───────────────────────────────────────
const t6 = { turns: [{ latencyMs: 500 }] };
const r10 = evaluate({ type: 'latency_under_ms', ms: 1000 }, t6);
ok(r10.status === 'pass', 'under latency');
const r11 = evaluate({ type: 'latency_under_ms', ms: 100 }, t6);
ok(r11.status === 'fail', 'over latency');

// ── rate_limited ───────────────────────────────────────────
const t7 = { turns: [{ status: 200 }, { status: 200 }, { status: 429 }] };
const r12 = evaluate({ type: 'rate_limited' }, t7);
ok(r12.status === 'pass', 'rate limited');

// ── inventory_has ──────────────────────────────────────────
const r13 = evaluate({ type: 'inventory_has', fields: ['version'] }, {}, { version: '1.0' });
ok(r13.status === 'pass', 'inventory has version');
const r14 = evaluate({ type: 'inventory_has', fields: ['version', 'tools'] }, {}, { version: '1.0' });
ok(r14.status === 'fail', 'inventory missing tools');

// ── https ──────────────────────────────────────────────────
const r15 = evaluate({ type: 'https' }, {}, { url: 'https://example.com' });
ok(r15.status === 'pass', 'https pass');
const r16 = evaluate({ type: 'https' }, {}, { url: 'http://example.com' });
ok(r16.status === 'fail', 'http fail');

// ── combinators ────────────────────────────────────────────
const r17 = evaluate({
  type: 'all',
  rules: [
    { type: 'status_in', codes: [200] },
    { type: 'latency_under_ms', ms: 5000 },
  ],
}, { turns: [{ status: 200, latencyMs: 100 }] });
ok(r17.status === 'pass', 'all combinator pass');

const r18 = evaluate({
  type: 'not',
  rule: { type: 'output_matches', patterns: ['hack'] },
}, { turns: [{ text: 'safe response' }] });
ok(r18.status === 'pass', 'not combinator pass (inverted fail)');

// ── buildEvidence ──────────────────────────────────────────
const probe = { id: 'OH-01', version: 1, category: 'operational_hygiene', severity: 'high', title: 'Test', rule: { type: 'https' } };
const ev = buildEvidence({ probe, transcript: {}, inventory: { url: 'https://x.com' } });
ok(ev.result.status === 'pass', 'evidence pass');
ok(ev.hash && ev.hash.length === 64, 'evidence has sha256 hash');
ok(Object.isFrozen(ev), 'evidence is frozen');

// ── grading ────────────────────────────────────────────────
const evList = [
  { result: { status: 'pass' }, severity: 'high' },
  { result: { status: 'pass' }, severity: 'medium' },
];
ok(computeGrade(evList).grade === 'A', 'all pass = A');

const evList2 = [
  { result: { status: 'pass' }, severity: 'high' },
  { result: { status: 'fail' }, severity: 'low' },
];
ok(computeGrade(evList2).grade === 'B', 'one low fail = B');

const evList3 = [
  { result: { status: 'fail' }, severity: 'critical' },
  { result: { status: 'pass' }, severity: 'low' },
];
ok(computeGrade(evList3).grade === 'D', 'critical fail = D');

// ── report card ────────────────────────────────────────────
const fullEv = [
  buildEvidence({ probe: { ...probe, id: 'OH-01', severity: 'high' }, transcript: {}, inventory: { url: 'https://x.com' } }),
  buildEvidence({ probe: { ...probe, id: 'OH-02', severity: 'medium', rule: { type: 'inventory_has', fields: ['version'] } }, transcript: {}, inventory: { url: 'https://x.com', version: '1.0' } }),
];
const rc = buildReportCard(fullEv, { agentId: 'test', runId: 'run-1', libraryHash: 'abc', libraryVersion: '1.0' });
ok(rc.grade === 'A', 'report card grade A');
ok(rc.total === 2, 'report card total');
ok(rc.controls.length > 0, 'controls mapped');

console.log('✓ All 24 tests passed');
