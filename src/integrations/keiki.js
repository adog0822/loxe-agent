// KEIKI INTEGRATION
// Keiki (https://onkeiki.com) is Loxe's messaging front door. One Keiki agent ("clearance"),
// defined in code in keiki-agent/ with @onkeiki/agents and pushed with kit.sync(), carries the
// four Loxe tools. Keiki connects that one agent to iMessage, Slack, Telegram, email
// (AgentMail), WhatsApp and an OpenAI-compatible API gateway; the tools are the same everywhere.
//
// Confirmed against Keiki's own docs and OpenAPI (https://onkeiki.com/openapi.json):
//   GET  /api/v1/openai/models                       list agents whose API gateway is on (status)
//   POST /api/v1/openai/chat/completions             one agent turn; model = agent name or id
//   POST /api/v1/developer/agents/{agentId}/notice   tell the agent about an event (notify)
// The old api.onkeiki.com host and /api/agents, /api/notifications endpoints do not exist.
//
// Env:
//   KEIKI_API_KEY        sk_live_/sk_test_ developer key (agents:write for notices, agents:chat for status)
//   KEIKI_AGENT_ID       the Keiki agent id printed by `bun run sync` in keiki-agent/
//   KEIKI_PLATFORM_URL   optional, default https://onkeiki.com (same var the SDK reads)
//   KEIKI_AGENT_NAME     optional, default 'clearance' (the API-gateway model name)
//   KEIKI_NOTIFY_TARGETS optional JSON map { "<orgId>": "<conversation id, e.g. +15551234567>" }
//   KEIKI_NOTIFY_BROADCAST=1  optional: allow broadcast to the agent's recent conversations.
//                             Off by default: one Keiki agent serves every org, so a broadcast
//                             would tell other orgs about this org's agents.
//
// No key -> configured:false / null, no network call.

const TIMEOUT_MS = 10_000;

const apiKey = () => process.env.KEIKI_API_KEY || '';
const agentId = () => process.env.KEIKI_AGENT_ID || '';
const base = () => (process.env.KEIKI_PLATFORM_URL || 'https://onkeiki.com').replace(/\/+$/, '');
const agentName = () => process.env.KEIKI_AGENT_NAME || 'clearance';

const now = () => new Date().toISOString();

function redact(text) {
  const key = apiKey();
  let out = String(text ?? '');
  if (key) out = out.split(key).join('[redacted]');
  return out.replace(/sk_(live|test)_[A-Za-z0-9_-]+/g, 'sk_$1_[redacted]').slice(0, 300);
}

async function keikiFetch(path, init = {}) {
  const res = await fetch(`${base()}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${apiKey()}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = null; }
  return { ok: res.ok, status: res.status, body, text };
}

// ── Status ─────────────────────────────────────────────────────────────────
export async function status() {
  if (!apiKey()) return { configured: false, ok: null, detail: 'KEIKI_API_KEY not set', checkedAt: now() };
  try {
    const r = await keikiFetch('/api/v1/openai/models');
    if (!r.ok) {
      const why = r.status === 403 ? 'key lacks agents:chat scope' : redact(r.body?.error?.message || r.text);
      return { configured: true, ok: false, detail: `${r.status} ${why}`, checkedAt: now() };
    }
    const models = (r.body?.data || []).map((m) => m.id).filter(Boolean);
    const gateway = models.includes(agentName()) || (agentId() && models.includes(agentId()))
      ? `API gateway on for "${agentName()}"`
      : `API gateway not on for "${agentName()}" (turn it on in Agents > API gateway)`;
    const notify = agentId() ? 'notices ready' : 'KEIKI_AGENT_ID not set, notices off';
    return { configured: true, ok: true, detail: `${gateway}; ${notify}`, checkedAt: now() };
  } catch (err) {
    return { configured: true, ok: false, detail: redact(err.message), checkedAt: now() };
  }
}

// ── Notify ─────────────────────────────────────────────────────────────────
// notify({ orgId, type, agentName, oldGrade, newGrade, url, phone? }) -> result | null
// Sends a Keiki notice: text written for the agent, which decides how to tell the person in its
// own words on whatever channel that conversation lives on (iMessage, Slack, Telegram, email).
// `phone` is Keiki's conversation identity (E.164 for SMS/iMessage). Without one, the org's entry
// in KEIKI_NOTIFY_TARGETS is used; with neither, nothing is sent unless broadcast is enabled.
export async function notify({ orgId, type, agentName: name, oldGrade, newGrade, url, phone } = {}) {
  if (!apiKey() || !agentId()) return null;
  const target = phone || targetFor(orgId);
  const broadcast = process.env.KEIKI_NOTIFY_BROADCAST === '1';
  if (!target && !broadcast) return null;

  const text = noticeText({ type, name, oldGrade, newGrade, url });
  const body = target ? { text, phone: target } : { text };
  const r = await keikiFetch(`/api/v1/developer/agents/${encodeURIComponent(agentId())}/notice`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.warn(`[keiki.notify] ${r.status} ${redact(r.body?.error || r.text)}`);
    return { ok: false, status: r.status };
  }
  return { ok: true, status: r.status, ...(r.body || {}) };
}

function targetFor(orgId) {
  if (!orgId || !process.env.KEIKI_NOTIFY_TARGETS) return null;
  try {
    const map = JSON.parse(process.env.KEIKI_NOTIFY_TARGETS);
    return typeof map[orgId] === 'string' && map[orgId] ? map[orgId] : null;
  } catch {
    return null;
  }
}

function noticeText({ type, name, oldGrade, newGrade, url }) {
  const who = name ? `"${name}"` : 'An agent';
  if (type === 'grade_change' && oldGrade && newGrade) {
    const dir = newGrade < oldGrade ? 'improved' : 'dropped';
    return `Loxe re-cleared ${who}. Its grade ${dir} from ${oldGrade} to ${newGrade}.${url ? ` Clearance page: ${url}` : ''} Tell the owner briefly and offer to explain the failed findings.`;
  }
  if (type === 'sentinel_failed') {
    return `Loxe's scheduled re-check of ${who} could not finish.${url ? ` ${url}` : ''} Tell the owner and offer to retry.`;
  }
  return `Loxe update for ${who}${newGrade ? `: grade ${newGrade}` : ''}.${url ? ` ${url}` : ''}`;
}

// ── OpenAI-compatible gateway ──────────────────────────────────────────────
// For the CLI / any OpenAI SDK: new OpenAI({ ...openaiClientConfig(), apiKey: KEIKI_API_KEY }).
export function openaiClientConfig() {
  return { baseURL: `${base()}/api/v1/openai`, model: agentName() };
}

// ── Tool definitions ───────────────────────────────────────────────────────
// Plain-data mirror of keiki-agent/tools.js (which holds the executable Effect versions that
// kit.sync() bundles). `http` is the Loxe call from docs/API.md each tool makes with
// `Authorization: Bearer ${LOXE_API_KEY}`. `approval` maps to Keiki's ToolPolicy.approval.
export const KEIKI_TOOLS = [
  {
    name: 'submit_agent',
    description: 'Register an AI agent endpoint with Loxe and start a clearance run against it.',
    approval: 'ask',
    inputSchema: {
      type: 'object',
      required: ['name', 'url'],
      properties: { name: { type: 'string' }, url: { type: 'string', description: 'http(s) chat endpoint of the agent' } },
    },
    http: [{ method: 'POST', path: '/api/agents' }, { method: 'POST', path: '/api/agents/:id/runs' }],
  },
  {
    name: 'get_grade',
    description: 'Get the current Loxe grade, last run and evidence-chain status for an agent.',
    approval: 'allow',
    inputSchema: { type: 'object', required: ['agentId'], properties: { agentId: { type: 'string' } } },
    http: [{ method: 'GET', path: '/api/agents/:id' }, { method: 'GET', path: '/api/runs/:lastRunId' }],
  },
  {
    name: 'explain_finding',
    description: 'Explain one finding of a run in plain English, with the fix and the mapped controls.',
    approval: 'allow',
    inputSchema: {
      type: 'object',
      required: ['runId', 'probeId'],
      properties: { runId: { type: 'string' }, probeId: { type: 'string' } },
    },
    http: [{ method: 'GET', path: '/api/runs/:id' }],
  },
  {
    name: 'request_vendor_clearance',
    description: "Clear a third-party vendor's AI agent before you adopt it: registers it and starts a run.",
    approval: 'ask',
    inputSchema: {
      type: 'object',
      required: ['vendorName', 'url'],
      properties: { vendorName: { type: 'string' }, url: { type: 'string' }, notes: { type: 'string' } },
    },
    http: [{ method: 'POST', path: '/api/agents' }, { method: 'POST', path: '/api/agents/:id/runs' }],
  },
];

// ── Compatibility with the old server.js wiring ────────────────────────────
// GET /keiki/config used to serve an invented config; it now serves the real tool contract.
export function keikiAgentConfig(loxeBaseUrl) {
  return { agent: agentName(), loxeBaseUrl, gateway: openaiClientConfig(), tools: KEIKI_TOOLS };
}

// Keiki has no "register a remote tool server" endpoint. Registration is `bun run sync` in
// keiki-agent/, so this is a no-op kept so existing imports do not break.
export async function registerWithKeiki() {
  return null;
}
