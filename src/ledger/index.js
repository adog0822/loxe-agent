// APPEND-ONLY HASH-CHAINED LEDGER
// Every entry binds (agentId, seq, prevHash, payloadHash). payloadHash is the SHA-256 of the
// canonical JSON of the payload exactly as stored, so anyone holding the rows can recompute
// every hash without trusting Loxe. Postgres blocks UPDATE/DELETE (migration 001 trigger);
// appends for one agent are serialized with an advisory lock so seq never forks.
import { GENESIS, canonicalize, entryHash, sha256, id } from '../core/canonical.js';

export class Ledger {
  constructor(db) {
    this.db = db; // createDb() instance: query() + tx()
  }

  // Append one payload to the agent's chain. kind: 'evidence' | 'decision'.
  async append(agentId, payload, { kind = 'evidence', runId = null } = {}) {
    const body = canonicalize(payload);
    const payloadHash = sha256(body);
    return this.db.tx(async (t) => {
      await t.query(`select pg_advisory_xact_lock(hashtext($1))`, [agentId]);
      const prev = (await t.query(
        `select seq, entry_hash from ledger where agent_id = $1 order by seq desc limit 1`,
        [agentId]
      )).rows[0];
      const seq = prev ? prev.seq + 1 : 0;
      const prevHash = prev ? prev.entry_hash : GENESIS;
      const eHash = entryHash({ agentId, seq, prevHash, payloadHash });
      const row = await t.query(
        `insert into ledger (id, agent_id, seq, prev_hash, payload_hash, entry_hash, payload, kind, run_id)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning seq, entry_hash, payload_hash, created_at`,
        [id('le'), agentId, seq, prevHash, payloadHash, eHash, body, kind, runId]
      );
      return row.rows[0];
    });
  }

  // Recompute the whole chain. Returns { valid, length, head, error?, brokenAt? }.
  async verify(agentId) {
    const rows = (await this.db.query(
      `select seq, prev_hash, payload_hash, entry_hash, payload from ledger where agent_id = $1 order by seq asc`,
      [agentId]
    )).rows;
    return verifyRows(agentId, rows);
  }

  // Find an entry by its entry hash or payload hash (what a buyer pastes from a report).
  async findByHash(hash) {
    const row = (await this.db.query(
      `select agent_id, seq, entry_hash, payload_hash, kind, run_id, created_at
       from ledger where entry_hash = $1 or payload_hash = $1 limit 1`,
      [hash]
    )).rows[0];
    if (!row) return { found: false };
    const upTo = (await this.db.query(
      `select seq, prev_hash, payload_hash, entry_hash, payload from ledger
       where agent_id = $1 and seq <= $2 order by seq asc`,
      [row.agent_id, row.seq]
    )).rows;
    const chain = verifyRows(row.agent_id, upTo);
    return {
      found: true,
      agentId: row.agent_id,
      seq: row.seq,
      kind: row.kind,
      runId: row.run_id,
      entryHash: row.entry_hash,
      payloadHash: row.payload_hash,
      recordedAt: row.created_at,
      chainValidAtEntry: chain.valid,
    };
  }

  async head(agentId) {
    const r = (await this.db.query(
      `select seq, entry_hash from ledger where agent_id = $1 order by seq desc limit 1`,
      [agentId]
    )).rows[0];
    return r ? { seq: r.seq, hash: r.entry_hash, length: r.seq + 1 } : { seq: -1, hash: null, length: 0 };
  }

  async entriesForRun(runId) {
    return (await this.db.query(
      `select seq, kind, prev_hash, payload_hash, entry_hash, payload, created_at
       from ledger where run_id = $1 order by seq asc`,
      [runId]
    )).rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));
  }

  // Full chain export for offline verification (scripts/verify-ledger.js).
  async export(agentId) {
    const rows = (await this.db.query(
      `select seq, kind, prev_hash, payload_hash, entry_hash, payload, created_at
       from ledger where agent_id = $1 order by seq asc`,
      [agentId]
    )).rows;
    return { format: 'loxe-ledger/1', agentId, genesis: GENESIS, entries: rows };
  }
}

// Pure chain check, shared by the server and the offline verifier.
export function verifyRows(agentId, rows) {
  let expectedPrev = GENESIS;
  for (const [i, row] of rows.entries()) {
    const fail = (error) => ({ valid: false, length: rows.length, head: null, brokenAt: row.seq, error });
    if (row.seq !== i) return fail(`seq ${row.seq}: expected seq ${i} (entry missing or reordered)`);
    if (row.prev_hash !== expectedPrev) return fail(`seq ${row.seq}: prev_hash does not match the entry before it`);
    const body = typeof row.payload === 'string' ? row.payload : canonicalize(row.payload);
    if (sha256(body) !== row.payload_hash) return fail(`seq ${row.seq}: payload does not match its hash`);
    const computed = entryHash({ agentId, seq: row.seq, prevHash: row.prev_hash, payloadHash: row.payload_hash });
    if (computed !== row.entry_hash) return fail(`seq ${row.seq}: entry hash does not recompute`);
    expectedPrev = row.entry_hash;
  }
  return { valid: true, length: rows.length, head: rows.length ? rows[rows.length - 1].entry_hash : null };
}
