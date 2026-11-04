// First-run answers, kept per user in localStorage. They only reorder things; nothing is hidden.

export const WHERE = [
  ['url', 'A URL I can paste', 'Any HTTPS endpoint that takes a message and replies.'],
  ['maritime', 'Hosted on Maritime', 'Pick it from your Maritime account in one click.'],
  ['keiki', 'Run through Keiki', 'Clear and grade it by texting the Keiki agent.'],
  ['mcp', 'An MCP server', 'A tool server that other agents call.'],
];
export const FRAMEWORKS = [
  ['soc2', 'SOC 2'],
  ['iso42001', 'ISO/IEC 42001'],
  ['nist-ai-rmf', 'NIST AI RMF'],
  ['owasp-llm', 'OWASP LLM Top 10'],
];
export const ALERTS = [
  ['slack', 'Slack'],
  ['imessage', 'iMessage'],
  ['telegram', 'Telegram'],
  ['email', 'Email'],
  ['none', 'No alerts'],
];

const key = (userId) => `loxe-prefs:${userId || 'anon'}`;

export function getPrefs(userId) {
  try { return JSON.parse(localStorage.getItem(key(userId)) || 'null'); } catch { return null; }
}
export function setPrefs(userId, prefs) {
  try { localStorage.setItem(key(userId), JSON.stringify({ ...prefs, at: new Date().toISOString() })); } catch {}
}

// Frameworks the user picked come first, in their order; the rest follow.
export function orderFrameworks(ids, prefs) {
  const pick = prefs?.frameworks || [];
  return [...ids].sort((a, b) => rank(a, pick) - rank(b, pick));
}
const rank = (id, pick) => (pick.includes(id) ? pick.indexOf(id) : 10 + FRAMEWORKS.findIndex(([k]) => k === id));

export const alertLabel = (id) => ALERTS.find(([k]) => k === id)?.[1] || null;
