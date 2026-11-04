// TARGET GUARD — Loxe sends requests to URLs that users give it, so it must not be usable to
// reach internal networks (SSRF). Three layers:
//   1. assertProbeable(): at registration and before every run, every resolved address must be
//      public unicast (ipaddr.js range 'unicast'; IPv4-mapped / NAT64 / 6to4 forms are unwrapped).
//   2. guardedDispatcher(): an undici Agent whose DNS lookup re-checks each address at connect
//      time, so a rebinding DNS answer between check and fetch is refused.
//   3. The collector never follows redirects (redirect: 'manual').
// Private targets are allowed only with LOXE_ALLOW_PRIVATE_TARGETS=1 (local dev; off in production).
import { lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { Agent } from 'undici';

export function allowPrivateTargets() {
  const v = process.env.LOXE_ALLOW_PRIVATE_TARGETS;
  if (v) return v === '1';
  return process.env.NODE_ENV !== 'production';
}

// True only for globally routable unicast addresses.
export function isPublicAddress(ip) {
  let addr;
  try {
    addr = ipaddr.parse(ip);
  } catch {
    return false;
  }
  if (addr.kind() === 'ipv6') {
    const v6 = addr;
    if (v6.isIPv4MappedAddress()) return isPublicAddress(v6.toIPv4Address().toString());
    const bytes = v6.toByteArray();
    // Deprecated IPv4-compatible form (::a.b.c.d): judge the embedded IPv4 address.
    if (bytes.slice(0, 12).every((b) => b === 0)) return isPublicAddress(ipaddr.IPv4.fromBytes(...bytes.slice(12)).toString());
    const range = v6.range();
    // NAT64 (64:ff9b::/96) and 6to4 (2002::/16) embed an IPv4 address: judge that instead.
    if (range === 'rfc6052' || range === 'rfc6145') return isPublicAddress(ipaddr.IPv4.fromBytes(...v6.toByteArray().slice(12)).toString());
    if (range === '6to4') return isPublicAddress(ipaddr.IPv4.fromBytes(...v6.toByteArray().slice(2, 6)).toString());
    return range === 'unicast';
  }
  return addr.range() === 'unicast';
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
  if (u.username || u.password) throw new Error('put credentials in an auth header, not in the URL');
  if (allowPrivateTargets()) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = ipaddr.isValid(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`cannot resolve ${host}`);
  if (!addrs.every((a) => isPublicAddress(a.address)))
    throw new Error(`${host} resolves to a private or reserved address; Loxe only probes public endpoints`);
  return u;
}

// undici dispatcher that refuses to connect to any non-public address, checked per connection.
let dispatcher;
export function guardedDispatcher() {
  if (allowPrivateTargets()) return undefined;
  dispatcher ||= new Agent({
    connect: {
      lookup(hostname, options, cb) {
        dnsLookup(hostname, { ...options, all: true }, (err, addrs) => {
          if (err) return cb(err);
          const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: options.family }];
          const bad = list.find((a) => !isPublicAddress(a.address));
          if (bad) return cb(new Error(`blocked non-public address for ${hostname}`));
          options.all ? cb(null, list) : cb(null, list[0].address, list[0].family);
        });
      },
    },
  });
  return dispatcher;
}
