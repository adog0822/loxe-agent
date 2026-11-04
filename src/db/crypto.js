// FIELD ENCRYPTION — agent auth headers are encrypted at rest with AES-256-GCM.
// Key: LOXE_DATA_KEY (32 bytes, hex or base64). Without it (local dev), a key is generated once and
// kept in settings. Stored form: "enc:v1:<iv b64>:<ciphertext+tag b64>". Older plaintext rows still read.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

let cached;

async function dataKey(db) {
  if (cached) return cached;
  const env = process.env.LOXE_DATA_KEY;
  if (env) {
    const k = /^[0-9a-f]{64}$/i.test(env) ? Buffer.from(env, 'hex') : Buffer.from(env, 'base64');
    if (k.length !== 32) throw new Error('LOXE_DATA_KEY must be 32 bytes (64 hex chars or base64)');
    return (cached = k);
  }
  const row = (await db.query(`select value from settings where key = 'data_key'`)).rows[0];
  if (row) return (cached = Buffer.from((typeof row.value === 'string' ? JSON.parse(row.value) : row.value).hex, 'hex'));
  const k = randomBytes(32);
  await db.query(`insert into settings (key, value) values ('data_key', $1) on conflict (key) do nothing`, [
    JSON.stringify({ hex: k.toString('hex') }),
  ]);
  return (cached = k);
}

export async function sealJson(db, obj) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', await dataKey(db), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj ?? {}), 'utf8'), c.final(), c.getAuthTag()]);
  return `enc:v1:${iv.toString('base64')}:${ct.toString('base64')}`;
}

export async function openJson(db, stored) {
  if (!stored) return {};
  if (!stored.startsWith('enc:v1:')) return JSON.parse(stored);
  const [, , ivB64, ctB64] = stored.split(':');
  const buf = Buffer.from(ctB64, 'base64');
  const d = createDecipheriv('aes-256-gcm', await dataKey(db), Buffer.from(ivB64, 'base64'));
  d.setAuthTag(buf.subarray(buf.length - 16));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(0, buf.length - 16)), d.final()]).toString('utf8'));
}
