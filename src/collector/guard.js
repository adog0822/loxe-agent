// TARGET GUARD — Loxe sends requests to URLs that users give it, so it must not be usable to
// reach internal networks (SSRF). Checked at registration and again before every run, since DNS
// can change. Private targets are allowed only with LOXE_ALLOW_PRIVATE_TARGETS=1 (local dev).
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function allowPrivateTargets() {
  const v = process.env.LOXE_ALLOW_PRIVATE_TARGETS;
  if (v) return v === '1';
  return process.env.NODE_ENV !== 'production';
}

function isPrivate(ip) {
  if (ip.includes(':')) {
    const v = ip.toLowerCase();
    if (v.startsWith('::ffff:')) return isPrivate(v.slice(7));
    return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
  }
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 10 || a === 127 || a === 0 ||
    (a === 169 && b === 254) ||          // link-local, incl. cloud metadata 169.254.169.254
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)   // carrier-grade NAT
  );
}

// Throws with a plain message when the URL may not be probed.
export async function assertProbeable(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('URL is not valid');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('URL must start with http:// or https://');
  if (allowPrivateTargets()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`cannot resolve ${host}`);
  if (addrs.some((a) => isPrivate(a.address))) throw new Error(`${host} resolves to a private address; Loxe only probes public endpoints`);
  return u;
}
