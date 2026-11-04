// Canonical JSON + hashing. Pure, dependency-free. Used by the verifier and ledger.
// Canonical form: object keys sorted recursively, undefined dropped, no whitespace.
import { createHash, randomBytes } from 'node:crypto';

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

export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

export function hashObject(obj) {
  return sha256(canonicalize(obj));
}

export const GENESIS = '0'.repeat(64);

// Ledger entry hash: binds sequence number, previous entry and this payload's hash.
export function entryHash({ agentId, seq, prevHash, payloadHash }) {
  return sha256(canonicalize({ agentId, seq, prevHash, payloadHash }));
}

export function id(prefix, bytes = 6) {
  return `${prefix}-${randomBytes(bytes).toString('hex')}`;
}

export function short(hash, n = 8) {
  return hash ? `${hash.slice(0, n)}…` : '';
}
