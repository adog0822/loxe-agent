// SUPERMEMORY INTEGRATION
// One Supermemory namespace per customer org. Each run's findings, accepted exceptions and
// policies are stored as documents; before each run we recall the agent's history ("has this
// agent failed this probe before?"). Supermemory holds context only. Postgres holds the proof:
// ledger entries, hashes and signatures never go here.
//
// Uses the `supermemory` 5.1.2 SDK (v5 API, namespace-scoped). Signatures from
// node_modules/supermemory/dist/esm/generated/Client.d.ts:
//   client.add(namespace, AddRequest)            POST /ns/{namespace}/document
//   client.search(namespace, SearchRequest)      POST /ns/{namespace}/search
//   client.list(namespace, 'documents', ListRequest)  POST /ns/{namespace}/list/documents
//   client.namespaces.list({ limit })            GET  /ns
//
// Env: SUPERMEMORY_API_KEY. No key -> configured:false / null / { items: [] }, no network call.
import { Supermemory } from 'supermemory';

const TIMEOUT_MS = 10_000;

const apiKey = () => process.env.SUPERMEMORY_API_KEY || '';

let client = null;
let clientKey = null;
function sdk() {
  const key = apiKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    client = new Supermemory({ apiKey: key, timeoutInSeconds: TIMEOUT_MS / 1000, maxRetries: 1 });
    clientKey = key;
  }
  return client;
}

// BaseRequestOptions: timeoutInSeconds, maxRetries, abortSignal.
const reqOpts = () => ({ timeoutInSeconds: TIMEOUT_MS / 1000, maxRetries: 1, abortSignal: AbortSignal.timeout(TIMEOUT_MS) });

const now = () => new Date().toISOString();
const clean = (s) => String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);

// One namespace per org.
export const namespaceFor = (orgId) => `loxe_org_${clean(orgId || 'default')}`;

function safeError(err) {
  const status = err?.statusCode ? `${err.statusCode} ` : '';
  return `${status}${String(err?.message || err || 'error')}`.replace(/sm_[A-Za-z0-9_-]+/g, 'sm_[redacted]').slice(0, 300);
}

const eq = (field, value) => ({ field, operator: 'eq', value: String(value) });
const and = (...operands) => ({ operator: 'and', operands });

// ── Status ─────────────────────────────────────────────────────────────────
export async function status() {
  const sm = sdk();
  if (!sm) return { configured: false, ok: null, detail: 'SUPERMEMORY_API_KEY not set', checkedAt: now() };
  try {
    await sm.namespaces.list({ limit: 1 }, reqOpts());
    return { configured: true, ok: true, detail: 'API reachable; one namespace per org', checkedAt: now() };
  } catch (err) {
    return { configured: true, ok: false, detail: safeError(err), checkedAt: now() };
  }
}

// ── Runs ───────────────────────────────────────────────────────────────────
// rememberRun({ orgId, agentId, agentName, report }) -> { namespace, stored, failed } | null
// One document per run (id run_<runId>) plus one fact document per failed finding
// (id finding_<agentId>_<probeId>, re-used across runs so its history accumulates).
export async function rememberRun({ orgId, agentId, agentName, report } = {}) {
  const sm = sdk();
  if (!sm || !agentId || !report) return null;
  const ns = namespaceFor(orgId);
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const failed = findings.filter((f) => f.status === 'fail');
  const at = report.ts || now();
  const name = agentName || agentId;

  const runDoc = {
    id: `run_${clean(report.runId)}`,
    content: [
      `Loxe clearance run ${report.runId} for agent "${name}" (${agentId}) on ${at}.`,
      `Grade ${report.grade}. ${report.gradeSummary || ''}`.trim(),
      `${report.passed ?? 0} passed, ${report.failed ?? 0} failed, ${report.inconclusive ?? 0} inconclusive of ${report.total ?? findings.length}.`,
      `Probe library ${report.libraryVersion || '?'}.`,
      failed.length ? `Failed probes: ${failed.map((f) => `${f.probeId} (${f.title}, ${f.severity})`).join('; ')}.` : 'No failed probes.',
    ].join('\n'),
    metadata: {
      kind: 'run', agentId: String(agentId), runId: String(report.runId), grade: String(report.grade ?? ''),
      title: `Run ${report.runId}: grade ${report.grade}`, at,
      failedProbeIds: failed.map((f) => String(f.probeId)),
    },
    group: { agentId: String(agentId) },
    date: at,
  };

  const factDocs = failed.map((f) => ({
    id: `finding_${clean(agentId)}_${clean(f.probeId)}`,
    content: [
      `Agent "${name}" (${agentId}) failed probe ${f.probeId} "${f.title}" in run ${report.runId} on ${at}.`,
      `Severity ${f.severity}, category ${f.category}.`,
      f.plainEnglish || '',
      f.engineer?.remediation?.summary ? `Suggested fix: ${f.engineer.remediation.summary}` : '',
    ].filter(Boolean).join('\n'),
    metadata: {
      kind: 'finding', agentId: String(agentId), probeId: String(f.probeId), runId: String(report.runId),
      severity: String(f.severity ?? ''), status: 'fail', title: `Failed ${f.probeId}: ${f.title}`, at,
    },
    group: { agentId: String(agentId) },
    date: at,
  }));

  const results = await Promise.allSettled([runDoc, ...factDocs].map((doc) => sm.add(ns, doc, reqOpts())));
  const bad = results.filter((r) => r.status === 'rejected');
  if (bad.length) console.warn(`[supermemory.rememberRun] ${bad.length} write(s) failed: ${safeError(bad[0].reason)}`);
  return { namespace: ns, stored: results.length - bad.length, failed: bad.length };
}

// ── Decisions (accepted exceptions, fixes) ─────────────────────────────────
// rememberDecision({ orgId, agentId, probeId, state, note }) -> { namespace, id } | null
// Same id per (agent, probe), so each new decision appends to that document's history.
export async function rememberDecision({ orgId, agentId, probeId, state, note } = {}) {
  const sm = sdk();
  if (!sm || !agentId || !probeId || !state) return null;
  const ns = namespaceFor(orgId);
  const at = now();
  const id = `decision_${clean(agentId)}_${clean(probeId)}`;
  await sm.add(ns, {
    id,
    content: `Decision on ${at} for agent ${agentId}, probe ${probeId}: ${state.replace(/_/g, ' ')}.${note ? ` Note: ${note}` : ''}`,
    metadata: { kind: 'decision', agentId: String(agentId), probeId: String(probeId), state: String(state), title: `Decision ${probeId}: ${state}`, at },
    group: { agentId: String(agentId) },
    date: at,
  }, reqOpts());
  return { namespace: ns, id };
}

// ── Policies ───────────────────────────────────────────────────────────────
// rememberPolicy({ orgId, policyId, title, text }) -> { namespace, id } | null
export async function rememberPolicy({ orgId, policyId, title, text } = {}) {
  const sm = sdk();
  if (!sm || !text) return null;
  const ns = namespaceFor(orgId);
  const id = `policy_${clean(policyId || title || 'default')}`;
  const at = now();
  await sm.add(ns, { id, content: `${title ? `${title}\n` : ''}${text}`, metadata: { kind: 'policy', title: title || 'Policy', at }, date: at }, reqOpts());
  return { namespace: ns, id };
}

// ── Recall ─────────────────────────────────────────────────────────────────
// recallAgent({ orgId, agentId, query? }) -> { items: [{ title, summary, at, kind, probeIds }] }
// Two reads, merged:
//  1. a deterministic list of this agent's finding/decision documents (metadata filter), which
//     is what answers "has this agent failed this probe before?" (probeIds on each item);
//  2. a semantic search for related learned context (policies, exceptions, past runs).
export async function recallAgent({ orgId, agentId, query } = {}) {
  const sm = sdk();
  if (!sm || !agentId) return { items: [] };
  const ns = namespaceFor(orgId);

  const [listed, searched] = await Promise.allSettled([
    sm.list(ns, 'documents', { limit: 50, sort: 'updatedAt', order: 'desc', filter: eq('agentId', agentId) }, reqOpts()),
    sm.search(ns, {
      query: query || `history of agent ${agentId}: failed probes, accepted exceptions, policies`,
      filter: eq('agentId', agentId),
      searchMode: 'hybrid',
      limit: 10,
    }, reqOpts()),
  ]);

  const items = [];
  if (listed.status === 'fulfilled') {
    for (const d of listed.value.documents || []) {
      const m = d.metadata || {};
      items.push({
        title: m.title || d.title || m.kind || 'Document',
        summary: d.summary || '',
        at: m.at || d.system?.updatedAt || null,
        kind: m.kind || null,
        probeIds: m.kind === 'finding' && m.probeId ? [String(m.probeId)]
          : m.kind === 'run' && Array.isArray(m.failedProbeIds) ? m.failedProbeIds.map(String) : [],
        state: m.state || null,
      });
    }
  } else {
    console.warn(`[supermemory.recallAgent] list failed: ${safeError(listed.reason)}`);
  }
  if (searched.status === 'fulfilled') {
    for (const r of searched.value.results || []) {
      const m = r.metadata || {};
      items.push({
        title: m.title || (r.memory ? 'Learned context' : 'Related passage'),
        summary: r.memory || r.chunk || '',
        at: r.system?.updatedAt || r.system?.createdAt || m.at || null,
        kind: m.kind || (r.memory ? 'memory' : 'chunk'),
        probeIds: m.kind === 'finding' && m.probeId ? [String(m.probeId)] : [],
        state: m.state || null,
      });
    }
  } else {
    console.warn(`[supermemory.recallAgent] search failed: ${safeError(searched.reason)}`);
  }
  return { items };
}

// hasFailedBefore({ orgId, agentId, probeId }) -> boolean | null (null when not configured)
export async function hasFailedBefore({ orgId, agentId, probeId } = {}) {
  const sm = sdk();
  if (!sm || !agentId || !probeId) return null;
  const res = await sm.list(namespaceFor(orgId), 'documents', {
    limit: 1, filter: and(eq('agentId', agentId), eq('kind', 'finding'), eq('probeId', probeId)),
  }, reqOpts());
  return (res.documents || []).length > 0;
}
