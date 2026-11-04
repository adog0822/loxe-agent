// OWL GUIDE — grounding for the "?" panel.
// The server never calls a model itself in production: POST /api/owl/context returns the system
// prompt plus the caller's own report context (auth + org scoped), and the Cloudflare Worker in
// front runs it on Workers AI. Locally, POST /api/owl uses the Workers AI REST API when
// CF_ACCOUNT_ID + CF_AI_TOKEN are set, else answers 503 so the UI shows "guide unavailable".
import { controlsTable } from '../mapper/index.js';
import { loadLibrary } from '../probes/library.js';

export const OWL_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

const FACTS = `You are the Loxe owl, the in-product guide for Loxe (loxeagent.loxeai.com).
Loxe clears AI agents: it sends a frozen library of 40 deterministic probes to an agent endpoint, judges each reply with pure code (no model decides pass or fail), grades the agent A to F, and maps every finding to SOC 2 (AICPA Trust Services Criteria 2017), OWASP Top 10 for LLM Applications 2025, NIST AI RMF 1.0 and ISO/IEC 42001:2023.
Grading: the worst open finding sets the grade. A all pass; B worst is low; C worst is medium; D any high or critical (one critical caps the grade at D); F more than half of decisive probes failed. Inconclusive results never move the grade.
Five categories: data exposure, tool permissions, injection resistance, harmful-action refusal, operational hygiene.
Evidence: each probe result is an evidence object (verdict, probe id and version, transcript hash, library hash, time). Its SHA-256 hash of the canonical JSON is the payload hash. Each ledger entry hashes (agent id, sequence number, previous entry hash, payload hash), so every entry depends on all earlier ones: editing or deleting any entry breaks every later hash. The first entry links to 64 zeros. Postgres refuses updates and deletes on the ledger. After each run Loxe signs the chain head with Ed25519; the public key is at /.well-known/loxe-signing-key.
Anyone can check: GET /verify/<agent-id> recomputes the chain; GET /verify?hash=<sha256> finds one entry; GET /ledger/<agent-id>/export downloads it; "node loxe.mjs verify <agent-id> --offline" recomputes it locally. Replay re-runs one probe and compares verdicts.
Decisions (accept exception, fix proposed, resolved) are appended to the ledger as their own entries.
Ways in: the web app; the public page /a/<agent-id> with badge and PDF; the Keiki agent on iMessage, Slack, Telegram and email ("clear <url>", "grade <agent-id>", "explain <run-id> <probe-id>"); the REST API with an org key (Bearer lx_...); the CLI (node loxe.mjs clear <url>); Maritime agents can be picked directly and are re-cleared on every deploy; the sentinel re-runs agents on a schedule.
Loxe works with an agent hosted anywhere (own servers, OpenAI, Vercel, LangChain, no-code builders): it only needs the URL the agent answers chat on. Maritime, Keiki and Supermemory are optional conveniences. An agent with no URL (one in iMessage or a phone app) can be tested by hand: Add agent > "No URL? Test it by hand". Loxe shows each test message, the owner sends it and pastes the reply back, and the same rules judge it. About 33 of the 40 tests can be done this way; the endpoint-only ones (HTTPS, error handling, rate limits, metadata) show as not tested, and tool tests are usually not decided because a chat app does not show tool calls. The report says it was tested by hand. Teams can connect Slack (alerts) and GitHub (a check that fails below a minimum grade) on the Integrations page.
Loxe never says certified, compliant or approved. The claim is: cleared against these probes on this date, verifiable here.
Answer in plain English, short (under 120 words unless asked for detail), concrete, no marketing words. If the question is about the user's report, use the context below and cite probe ids and control ids. If you do not know, say so.`;

function reportContext(run, probeId) {
  const r = run?.report;
  if (!r) return '';
  const fails = r.findings.filter((f) => f.status === 'fail');
  const lines = [
    `Current report: agent ${r.agentId}, run ${r.runId}, grade ${r.grade} (${r.gradeSummary}). ${r.passed} held, ${r.failed} gaps, ${r.inconclusive} untested. Library ${r.libraryVersion}. Ledger ${r.ledger.valid ? 'verifies' : 'does not verify'}, ${r.ledger.length} entries, head ${r.ledger.head}.`,
    'Open gaps:',
    ...fails.map((f) => `- ${f.probeId} ${f.title} (${f.severity}): ${f.engineer.reason}. Fix: ${f.engineer.remediation?.summary || 'n/a'}. Controls: ${f.auditor.controls.map((c) => `${c.framework}:${c.id}`).join(', ')}`),
  ];
  const f = probeId && r.findings.find((x) => x.probeId === probeId);
  if (f) {
    lines.push(`Finding in focus ${f.probeId}: ${f.plainEnglish} Rule ${f.engineer.rule}. Detail ${JSON.stringify(f.engineer.detail)}. Patch: ${f.engineer.remediation?.patch || 'none'}. Controls: ${f.auditor.controls.map((c) => `${c.framework}:${c.id} ${c.title}: ${c.plain}`).join(' | ')}. Evidence payload hash ${f.auditor.evidence.hash}, ledger seq ${f.auditor.evidence.ledgerSeq}.`);
  }
  return lines.join('\n');
}

function probeContext(probeId) {
  if (!probeId) return '';
  const p = loadLibrary().probes.find((x) => x.id === probeId);
  return p ? `Probe ${p.id} (${p.category}, ${p.severity}): ${p.description} Source: ${p.source}.` : '';
}

// Build the model messages for one question. `run` is the caller's own run row (already org-checked).
export function buildOwlMessages({ question, route, run, probeId }) {
  const controls = Object.values(controlsTable().controls)
    .map((c) => `${c.framework}:${c.id} ${c.title}: ${c.plain}`)
    .join('\n');
  const system = [
    FACTS,
    `Controls Loxe maps to:\n${controls}`,
    route ? `The user is on screen: ${String(route).replace(/[^\w#/:-]/g, '').slice(0, 100)}.` : '',
    probeContext(/^[A-Z]{2,4}-\d{2,3}$/.test(probeId || '') ? probeId : null),
    reportContext(run, probeId),
  ].filter(Boolean).join('\n\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: String(question).slice(0, 1000) },
  ];
}

// Local/dev fallback: Workers AI over REST.
export async function askViaRest(messages) {
  const { CF_ACCOUNT_ID, CF_AI_TOKEN } = process.env;
  if (!CF_ACCOUNT_ID || !CF_AI_TOKEN) return null;
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/run/${OWL_MODEL}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CF_AI_TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messages, max_tokens: 500 }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Workers AI ${res.status}`);
  return (await res.json()).result?.response || null;
}
