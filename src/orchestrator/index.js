// ORCHESTRATOR — runs the full clearance pipeline.
// load probes → collect transcripts → verify → write ledger → grade → report
//
// The Orchestrator is the top-level coordinator. It never decides pass/fail
// (that's the Verifier) and never writes evidence hashes (that's the Ledger).
import { id } from '../core/canonical.js';
import { loadLibrary } from '../probes/library.js';
import { Collector } from '../collector/index.js';
import { evaluate, buildEvidence } from '../verifier/index.js';
import { Ledger } from '../ledger/index.js';
import { buildReportCard } from '../mapper/index.js';

export class Orchestrator {
  constructor({ db, targetUrl, targetHeaders = {}, agentId, libraryPath }) {
    this.db = db;
    this.targetUrl = targetUrl;
    this.targetHeaders = targetHeaders;
    this.agentId = agentId;
    this.libraryPath = libraryPath;
    this.ledger = new Ledger(db);
  }

  async run({ onProgress } = {}) {
    const runId = id('run');
    const startedAt = new Date().toISOString();
    const lib = loadLibrary(this.libraryPath);
    const collector = new Collector({
      targetUrl: this.targetUrl,
      headers: this.targetHeaders,
    });

    const progress = (msg) => onProgress && onProgress({ runId, msg });

    // 1. Register the run
    await this.db.query(
      `INSERT INTO runs (id, agent_id, status, library_hash, library_version, started_at)
       VALUES ($1, $2, 'running', $3, $4, $5)`,
      [runId, this.agentId, lib.hash, lib.version, startedAt]
    );
    progress('run registered');

    // 2. Collect inventory once (used by inventory-kind probes and https check)
    const inventory = await collector.collectInventory();
    progress('inventory collected');

    // 3. Run each probe: collect → verify → ledger
    const evidenceList = [];
    for (const probe of lib.probes) {
      progress(`probe ${probe.id}: collecting`);

      let transcript;
      if (probe.kind === 'inventory') {
        transcript = { turns: [], url: this.targetUrl };
      } else {
        transcript = await collector.collect(probe);
      }

      // Record the vendor request
      await this.db.query(
        `INSERT INTO vendor_requests (id, run_id, probe_id, request_kind, response_body, status_code, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          id('vr'),
          runId,
          probe.id,
          probe.kind || 'turns',
          JSON.stringify(transcript),
          transcript.turns?.[0]?.httpStatus ?? null,
          transcript.turns?.[0]?.latencyMs ?? null,
        ]
      );

      progress(`probe ${probe.id}: evaluating`);
      const evidence = buildEvidence({
        probe,
        transcript,
        inventory,
        ts: new Date().toISOString(),
      });

      // Add runId to evidence for ledger querying
      const evidenceWithRun = { ...evidence, runId };
      await this.ledger.append(this.agentId, evidenceWithRun);
      evidenceList.push(evidence);
      progress(`probe ${probe.id}: ${evidence.result.status}`);
    }

    // 4. Build report card
    const reportCard = buildReportCard(evidenceList, {
      agentId: this.agentId,
      runId,
      libraryHash: lib.hash,
      libraryVersion: lib.version,
    });

    // 5. Update run record
    await this.db.query(
      `UPDATE runs SET status = 'completed', grade = $1, report = $2, finished_at = $3
       WHERE id = $4`,
      [reportCard.grade, JSON.stringify(reportCard), new Date().toISOString(), runId]
    );

    // 6. Update agent's current grade
    await this.db.query(
      `UPDATE agents SET current_grade = $1, last_run_id = $2, last_run_at = $3 WHERE id = $4`,
      [reportCard.grade, runId, new Date().toISOString(), this.agentId]
    );

    // 7. Verify the ledger chain
    const chainStatus = await this.ledger.verify(this.agentId);
    progress(`chain verified: ${chainStatus.valid ? 'intact' : 'BROKEN'}`);

    return {
      runId,
      agentId: this.agentId,
      reportCard,
      chainStatus,
      libraryHash: lib.hash,
      libraryVersion: lib.version,
    };
  }
}
