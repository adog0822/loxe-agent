// Pluggable, versioned probe library. Probes are DATA: loaded from a JSON file,
// validated, frozen, and hashed. The library hash is recorded on every run so an
// auditor knows exactly which battery an agent was cleared against.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashObject } from '../core/canonical.js';

export const CATEGORIES = {
  data_exposure: 'Data exposure',
  tool_permissions: 'Tool permissions',
  injection_resistance: 'Injection resistance',
  harmful_action_refusal: 'Harmful-action refusal',
  operational_hygiene: 'Operational hygiene',
};
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const KINDS = ['turns', 'raw', 'burst', 'inventory'];

export function validateProbe(p) {
  const errs = [];
  if (!p.id || !/^[A-Z]{2,4}-\d{2,3}$/.test(p.id)) errs.push(`bad id ${p.id}`);
  if (!Number.isInteger(p.version)) errs.push(`${p.id}: version must be integer`);
  if (!CATEGORIES[p.category]) errs.push(`${p.id}: unknown category ${p.category}`);
  if (!SEVERITIES.includes(p.severity)) errs.push(`${p.id}: unknown severity ${p.severity}`);
  if (!p.title) errs.push(`${p.id}: missing title`);
  if (!p.rule || !p.rule.type) errs.push(`${p.id}: missing rule`);
  const kind = p.kind || 'turns';
  if (!KINDS.includes(kind)) errs.push(`${p.id}: unknown kind ${kind}`);
  if (kind === 'turns' && !(Array.isArray(p.turns) && p.turns.length)) errs.push(`${p.id}: turns required`);
  if (kind === 'raw' && !p.raw) errs.push(`${p.id}: raw required`);
  if (kind === 'burst' && !(p.burst && p.burst.count > 0)) errs.push(`${p.id}: burst.count required`);
  return errs;
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}

export function loadLibrary(path) {
  const candidates = [path, process.env.LOXE_PROBE_LIBRARY, 'probes/library.json', 'probes/library.example.json']
    .filter(Boolean)
    .map((p) => resolve(p));
  const file = candidates.find((p) => existsSync(p));
  if (!file) throw new Error('No probe library found (probes/library.json)');
  const lib = JSON.parse(readFileSync(file, 'utf8'));
  if (!lib.version || !Array.isArray(lib.probes)) throw new Error(`${file}: needs {version, probes[]}`);
  const errs = lib.probes.flatMap(validateProbe);
  const ids = lib.probes.map((p) => p.id);
  const dupes = ids.filter((x, i) => ids.indexOf(x) !== i);
  if (dupes.length) errs.push(`duplicate ids: ${dupes.join(', ')}`);
  if (errs.length) throw new Error(`Invalid probe library ${file}:\n  ${errs.join('\n  ')}`);
  const hash = hashObject(lib.probes);
  return deepFreeze({ file, version: String(lib.version), name: lib.name || 'loxe', hash, probes: lib.probes });
}

let cached;
export function library() {
  if (!cached) cached = loadLibrary();
  return cached;
}
export function probeById(id) {
  return library().probes.find((p) => p.id === id);
}
