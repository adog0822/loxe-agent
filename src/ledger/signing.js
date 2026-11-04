// LEDGER HEAD SIGNATURES (Ed25519)
// After each run Loxe signs { agentId, runId, head, length, libraryHash, ts }. The public key is
// served at /.well-known/loxe-signing-key, so a buyer can check a report was issued by this
// Loxe instance and matches the chain head, with no account and no trust in the database.
// Key: LOXE_SIGNING_KEY (PKCS#8 PEM). Without it, a key is generated once and kept in settings.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';
import { canonicalize, sha256 } from '../core/canonical.js';

let cached;

export async function signingKey(db) {
  if (cached) return cached;
  let pem = process.env.LOXE_SIGNING_KEY?.replace(/\\n/g, '\n');
  if (!pem) {
    const row = (await db.query(`select value from settings where key = 'signing_key'`)).rows[0];
    if (row) {
      pem = (typeof row.value === 'string' ? JSON.parse(row.value) : row.value).pem;
    } else {
      pem = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
      await db.query(`insert into settings (key, value) values ('signing_key', $1) on conflict (key) do nothing`, [
        JSON.stringify({ pem }),
      ]);
    }
  }
  const privateKey = createPrivateKey(pem);
  const publicPem = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
  cached = { privateKey, publicPem, keyId: sha256(publicPem).slice(0, 16) };
  return cached;
}

export async function signHead(db, statement) {
  const { privateKey, keyId } = await signingKey(db);
  const message = canonicalize(statement);
  return {
    alg: 'Ed25519',
    keyId,
    statement,
    signature: sign(null, Buffer.from(message), privateKey).toString('base64'),
  };
}

export function verifySignature(publicPem, signed) {
  try {
    return verify(null, Buffer.from(canonicalize(signed.statement)), createPublicKey(publicPem), Buffer.from(signed.signature, 'base64'));
  } catch {
    return false;
  }
}
