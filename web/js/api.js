// API client. Relative URLs, Bearer token for Clerk, cookie for dev auth.
// In ?mock=1 every call is answered by js/mock.js instead of the network.

// Two ways into the demo workspace: ?mock=1 (whole session, for development) or the Demo switch in the
// nav, which flips this flag for the tab. Demo calls never reach the network, so the real workspace
// is untouched while you are in it.
export const MOCK = new URLSearchParams(location.search).get('mock') === '1';
let demo = MOCK;
try { if (sessionStorage.getItem('loxe-demo') === '1') demo = true; } catch {}
export const isDemo = () => demo;
export async function setDemo(on) {
  demo = MOCK || !!on;
  try { on ? sessionStorage.setItem('loxe-demo', '1') : sessionStorage.removeItem('loxe-demo'); } catch {}
  if (on) { const m = await loadMock(); await m.reset(); }
}
let mock = null;
let tokenFn = null;
let onUnauthorized = () => {};

export function setTokenProvider(fn) { tokenFn = fn; }
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

export class ApiError extends Error {
  constructor(status, message, body, path) {
    super(message);
    this.status = status;
    this.body = body;
    this.path = path;
  }
}

async function loadMock() {
  if (!mock) mock = await import('./mock.js');
  return mock;
}

export async function request(method, path, body) {
  if (demo) {
    const m = await loadMock();
    // A small, honest delay so loading states are visible in mock mode.
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 160));
    const res = await m.handle(method, path, body);
    if (res.status === 401) { onUnauthorized(); throw new ApiError(401, 'Your session ended.', res.body, path); }
    if (res.status >= 400) throw new ApiError(res.status, res.body?.error || `HTTP ${res.status}`, res.body, path);
    return res.body;
  }
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (tokenFn) {
    const t = await tokenFn();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin' });
  } catch (e) {
    throw new ApiError(0, 'Loxe could not reach its server. Check your connection and try again.', null, path);
  }
  if (res.status === 401 && path !== '/api/me') { onUnauthorized(); throw new ApiError(401, 'Your session ended.', null, path); }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || `HTTP ${res.status} from ${path}`, data, path);
  return data;
}

export const api = {
  config: () => request('GET', '/api/config'),
  me: () => request('GET', '/api/me'),
  devLogin: (email) => request('POST', '/api/dev/login', { email }),
  agents: () => request('GET', '/api/agents'),
  agent: (id) => request('GET', `/api/agents/${id}`),
  createAgent: (body) => request('POST', '/api/agents', body),
  deleteAgent: (id) => request('DELETE', `/api/agents/${id}`),
  startRun: (id) => request('POST', `/api/agents/${id}/runs`),
  runs: (id) => request('GET', `/api/agents/${id}/runs`),
  sentinel: (id, body) => request('POST', `/api/agents/${id}/sentinel`, body),
  visibility: (id, isPublic) => request('POST', `/api/agents/${id}/visibility`, { public: isPublic }),
  run: (id) => request('GET', `/api/runs/${id}`),
  handScript: (runId) => request('GET', `/api/runs/${runId}/script`),
  saveReply: (runId, probeId, body) => request('PUT', `/api/runs/${runId}/replies/${encodeURIComponent(probeId)}`, body),
  finishHand: (runId) => request('POST', `/api/runs/${runId}/finish`),
  decide: (runId, probeId, state, note) => request('POST', `/api/runs/${runId}/findings/${encodeURIComponent(probeId)}/decision`, { state, note }),
  integrations: () => request('GET', '/api/integrations'),
  maritimeAgents: () => request('GET', '/api/maritime/agents'),
  teamIntegrations: () => request('GET', '/api/org/integrations'),
  slackConnect: (url, mode) => request('PUT', '/api/org/integrations/slack', { url, mode }),
  slackMode: (mode) => request('PATCH', '/api/org/integrations/slack', { mode }),
  slackTest: () => request('POST', '/api/org/integrations/slack/test'),
  slackDisconnect: () => request('DELETE', '/api/org/integrations/slack'),
  memory: (id) => request('GET', `/api/memory/${id}`),
  verify: (id) => request('GET', `/verify/${id}`),
  lookupHash: (hash) => request('GET', `/verify?hash=${encodeURIComponent(hash)}`),
  ledger: (id) => request('GET', `/api/agents/${id}/ledger`),
  replay: (runId, probeId) => request('POST', `/api/runs/${runId}/replay/${encodeURIComponent(probeId)}`),
  keys: () => request('GET', '/api/keys'),
  createKey: (name) => request('POST', '/api/keys', { name }),
  deleteKey: (id) => request('DELETE', `/api/keys/${id}`),
  devLogout: () => request('POST', '/api/dev/logout'),
  owl: (question, context) => request('POST', '/api/owl', { question, context }),
};

// Where snippets point. On a local or preview host, show the production address.
export const BASE = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) ? 'https://loxeagent.loxeai.com' : location.origin;
export const demoApi = () => loadMock();

// Public URLs. Absolute so they can be pasted anywhere.
// In the guided demo these point at the server's real demo clearance (src/demo), so the PDF,
// public page and ledger the owl shows are real evidence, not fixtures.
export const publicUrl = {
  page: (id) => (demo ? `${location.origin}/demo/page` : `${location.origin}/a/${id}`),
  badge: (id) => `${location.origin}/badge/${id}`,
  pdf: (runId) => (demo ? `${location.origin}/demo/report.pdf` : `${location.origin}/report/${runId}/pdf`),
  verify: (id) => (demo ? `${location.origin}/demo/verify` : `${location.origin}/verify/${id}`),
  transcripts: (runId) => `${location.origin}/api/runs/${runId}/transcripts`,
};

export async function badgeSrc(id) {
  if (demo) return (await loadMock()).badgeDataUrl(id);
  return `/badge/${id}`;
}
