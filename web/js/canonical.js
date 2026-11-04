// Browser twin of src/core/canonical.js. Same canonical form, same entry hash,
// so the ledger trace recomputes what the server stores, byte for byte.

export const GENESIS = '0'.repeat(64);

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return 'null';
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => (v === undefined ? 'null' : canonicalize(v))).join(',') + ']';
  }
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

export async function sha256(input) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const hashObject = (obj) => sha256(canonicalize(obj));

export const entryHash = ({ agentId, seq, prevHash, payloadHash }) =>
  sha256(canonicalize({ agentId, seq, prevHash, payloadHash }));
