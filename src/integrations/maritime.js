// MARITIME INTEGRATION
// Loxe runs as a Maritime agent, and Maritime is also an intake source: pick one of your
// Maritime-hosted agents and clear it. Everything here uses maritime-sdk 0.11.0 as typed in
// node_modules/maritime-sdk/dist/index.d.ts (line numbers in comments refer to that file).
//
// Env:
//   MARITIME_API_KEY         mk_... account key (agents.list / agents.get)
//   MARITIME_WEBHOOK_SECRET  whsec_... signing secret of the webhook subscription
//   MARITIME_API_URL         optional, read by the SDK itself (default https://api.maritime.sh)
//
// Every call degrades cleanly: no key -> configured:false / [] / null, and no network call.
import { Maritime, verifyWebhookSignature, pushSchedules } from 'maritime-sdk';

const TIMEOUT_MS = 10_000;

const apiKey = () => process.env.MARITIME_API_KEY || '';
const webhookSecret = () => process.env.MARITIME_WEBHOOK_SECRET || '';

let client = null;
let clientKey = null;
function sdk() {
  const key = apiKey();
  if (!key) return null;
  if (!client || clientKey !== key) {
    // MaritimeClientOptions (d.ts line 1): apiKey, timeout (ms), maxRetries.
    client = new Maritime({ apiKey: key, timeout: TIMEOUT_MS, maxRetries: 1 });
    clientKey = key;
  }
  return client;
}

const now = () => new Date().toISOString();

// Error text without anything that could carry a key.
function safeError(err) {
  const status = err?.status ? `${err.status} ` : '';
  const msg = String(err?.detail || err?.message || err || 'error').replace(/mk_[A-Za-z0-9_-]+/g, 'mk_[redacted]');
  return `${status}${msg}`.slice(0, 300);
}

// Agent (d.ts line 645) -> the shape docs/API.md promises for GET /api/maritime/agents.
// `webUrl` is the agent's own https://<id>.mtm.sh/ host (null without an exposedPort).
function toIntake(a) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    status: a.status,
    url: a.webUrl || a.publicUrl || null,
    framework: a.framework ?? null,
    externalId: a.externalId ?? null,
    visibility: a.visibility ?? null,
    updatedAt: a.updatedAt ?? null,
  };
}

// ── Status ─────────────────────────────────────────────────────────────────
export async function status() {
  const m = sdk();
  if (!m) {
    return { configured: false, ok: null, detail: 'MARITIME_API_KEY not set', checkedAt: now() };
  }
  try {
    const agents = await m.agents.list(); // AgentsResource.list (d.ts line 1912)
    const webhook = webhookSecret() ? 'webhook secret set' : 'MARITIME_WEBHOOK_SECRET not set';
    return { configured: true, ok: true, detail: `${agents.length} agent(s) visible; ${webhook}`, checkedAt: now() };
  } catch (err) {
    return { configured: true, ok: false, detail: safeError(err), checkedAt: now() };
  }
}

// ── Intake ─────────────────────────────────────────────────────────────────
// listAgents() -> [{ id, name, status, url }]
export async function listAgents() {
  const m = sdk();
  if (!m) return [];
  const agents = await m.agents.list();
  return agents.map(toIntake);
}

// getAgent(id) -> { id, name, status, url, ... } | null
export async function getAgent(id) {
  const m = sdk();
  if (!m || !id) return null;
  try {
    return toIntake(await m.agents.get(id)); // AgentsResource.get (d.ts line 1910)
  } catch (err) {
    if (err?.status === 404) return null;
    throw err;
  }
}

// ── Webhooks ───────────────────────────────────────────────────────────────
// Maritime signs each delivery with `X-Maritime-Signature: sha256=<hex hmac>` over the raw body
// (WebhooksResource doc, d.ts line 2866; verifyWebhookSignature, d.ts line 2913).
// Pass the RAW body string/bytes, never re-serialized JSON. headers: Headers or plain object.
export async function verifyWebhook(rawBody, headers) {
  const secret = webhookSecret();
  if (!secret || rawBody == null) return false;
  const signature = readHeader(headers, 'x-maritime-signature');
  if (!signature) return false;
  try {
    return await verifyWebhookSignature({ secret, body: rawBody, signature });
  } catch {
    return false;
  }
}

function readHeader(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  const hit = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const v = hit ? headers[hit] : null;
  return Array.isArray(v) ? v[0] : v ?? null;
}

// Best-effort read of a verified webhook body. The event name lives in `event` (SDK doc example,
// d.ts line 2909) and the body carries the agent's `external_id`. The exact agent-id field name
// is NOT documented in the SDK, so several spellings are tried.
export function parseWebhookEvent(rawBody) {
  try {
    const body = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(new TextDecoder().decode(rawBody));
    return {
      event: body.event ?? body.type ?? null,
      agentId: body.agent_id ?? body.agentId ?? body.agent?.id ?? body.data?.agent_id ?? body.data?.agentId ?? null,
      externalId: body.external_id ?? body.externalId ?? body.agent?.external_id ?? null,
      body,
    };
  } catch {
    return null;
  }
}

// ── Schedules (sentinel cron) ──────────────────────────────────────────────
// Maritime agents sleep between events; Maritime is the alarm clock. Serve this array on
// GET /schedules (Maritime polls it while awake) or push it with pushSchedulesNow().
// ScheduleView (d.ts line 3149): { id, cron | nextRunAt, tz, prompt, name, enabled }.
//
// IMPORTANT: a Maritime schedule does not call an arbitrary route. It wakes the VM and, when the
// entry has a `prompt`, delivers that text to the agent's POST /chat (source "scheduled")
// (README "Scheduled wakes"). So POST /chat must route SENTINEL_TICK_PROMPT to the same code as
// POST /sentinel/tick. Use isSentinelTick(message) in the /chat handler.
export const SENTINEL_TICK_PROMPT = 'loxe:sentinel-tick';

export function schedules() {
  return [
    {
      id: 'loxe-sentinel-tick',
      name: 'Loxe sentinel: re-clear due agents (POST /sentinel/tick)',
      cron: '0 * * * *',
      tz: 'UTC',
      prompt: SENTINEL_TICK_PROMPT,
      enabled: true,
    },
  ];
}

export function isSentinelTick(message) {
  return typeof message === 'string' && message.trim() === SENTINEL_TICK_PROMPT;
}

// pushSchedules (d.ts line 3191) reads MARITIME_BACKEND_URL / MARITIME_AGENT_ID /
// MARITIME_INTERNAL_TOKEN, which Maritime injects into every agent. Off-Maritime it is a no-op
// that resolves false without a network call. Call once at boot.
export async function pushSchedulesNow() {
  if (!process.env.MARITIME_BACKEND_URL || !process.env.MARITIME_AGENT_ID || !process.env.MARITIME_INTERNAL_TOKEN) {
    return false;
  }
  const timedFetch = (url, init = {}) => fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  return pushSchedules(schedules(), { fetch: timedFetch });
}

// Sandboxes: the SDK does expose ephemeral sandboxes (maritime.ephemeral.createEphemeral,
// d.ts line 2788), but they need a separate `sandboxes`-scoped key and a usage plan, and Loxe's
// probes are HTTP calls made by the orchestrator in this process. Moving probe runs into a
// sandbox would mean shipping the orchestrator into it, which is not a clean fit, so no sandbox
// helper is exported.
