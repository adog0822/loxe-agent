// APPEND-ONLY HASH-CHAINED LEDGER
// Every evidence object is bound to its sequence position and the previous
// entry's hash, forming an immutable chain. Tampering with any entry
// invalidates every subsequent hash. The ledger is stored in Postgres
// (with an immutability trigger) and verified on read.
import { GENESIS, entryHash, hashObject, id } from '../core/canonical.js';

export class Ledger {
  constructor(db) {
    this.db = db; // pg pool or client with query()
  }

  // Append one evidence object to the chain for an agent.
  // Returns the new ledger entry.
  async append(agentId, evidence) {
    const prev = await this._head(agentId);
    const seq = prev ? prev.seq + 1 : 0;
    const prevHash = prev ? prev.entry_hash : GENESIS;
    const payloadHash = evidence.hash || hashObject(evidence);
    const eHash = entryHash({ agentId, seq, prevHash, payloadHash });
    const entryId = id('le');

    const row = await this.db.query(
      `INSERT INTO ledger (id, agent_id, seq, prev_hash, payload_hash, entry_hash, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [entryId, agentId, seq, prevHash, payloadHash, eHash, JSON.stringify(evidence)]
    );
    return row.rows[0];
  }

  // Verify the full chain for an agent. Returns { valid, length, error? }.
  async verify(agentId) {
    const rows = await this.db.query(
      `SELECT seq, prev_hash, payload_hash, entry_hash, payload
       FROM ledger WHERE agent_id = $1 ORDER BY seq ASC`,
      [agentId]
    );
    let expected = GENESIS;
    for (const row of rows.rows) {
      const computed = entryHash({
        agentId,
        seq: row.seq,
        prevHash: row.prev_hash,
        payloadHash: row.payload_hash,
      });
      if (computed !== row.entry_hash) {
        return { valid: false, length: rows.rows.length, error: `seq ${row.seq}: hash mismatch` };
      }
      // Verify payload hash matches actual payload
      const actualPayloadHash = hashObject(JSON.parse(row.payload));
      if (actualPayloadHash !== row.payload_hash) {
        return {
          valid: false,
          length: rows.rows.length,
          error: `seq ${row.seq}: payload tampered`,
        };
      }
      if (row.prev_hash !== expected) {
        return { valid: false, length: rows.rows.length, error: `seq ${row.seq}: chain broken` };
      }
      expected = row.entry_hash;
    }
    return { valid: true, length: rows.rows.length };
  }

  // Get the latest entry for an agent.
  async _head(agentId) {
    const r = await this.db.query(
      `SELECT seq, entry_hash FROM ledger WHERE agent_id = $1 ORDER BY seq DESC LIMIT 1`,
      [agentId]
    );
    return r.rows[0] || null;
  }

  // Get all evidence for a run.
  async entriesForRun(runId) {
    // entries are associated via the evidence payload's runId
    const r = await this.db.query(
      `SELECT * FROM ledger WHERE payload->>'runId' = $1 ORDER BY seq ASC`,
      [runId]
    );
    return r.rows;
  }
}
