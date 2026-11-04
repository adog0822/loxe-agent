// ORCHESTRATOR — runs the full clearance pipeline as a background job.
// load probes → recall memory → collect → verify → ledger → map + grade → sign → report →
// remember + notify. It never decides pass/fail (the Verifier does) and never computes hashes
// (the Ledger does). Runs for one agent are serialized; runs for different agents overlap.
import { id } from '../core/canonical.js';
import { loadLibrary } from '../probes/library.js';
import { Collector } from '../collector/index.js';
import { assertProbeable } from '../collector/guard.js';
import { buildEvidence } from '../verifier/index.js';
import { Ledger } from '../ledger/index.js';
import { signHead } from '../ledger/signing.js';
import { buildReportCard, renderFinding } from '../mapper/index.js';
import { integration } from '../integrations/index.js';
import { openJson } from '../db/crypto.js';

export class Orchestrator {
  constructor({ db, baseUrl, libraryPath }) {
    this.db = db;
    this.baseUrl = baseUrl;
    this.libraryPath = libraryPath;
    this.ledger = new Ledger(db);
    this.perAgent = new Map(); // agentId → tail promise
  }

  // Create a queued run and start it. Returns immediately with the run id.
  async enqueue(agent, { trigger = 'manual' } = {}) {
    const lib = loadLibrary(this.libraryPath);
    const runId = id('run');
    await this.db.query(
      `insert into runs (id, agent_id, org_id, status, library_hash, library_version, started_at, progress, trigger)
       values ($1, $2, $3, 'queued', $4, $5, now(), $6, $7)`,
      [runId, agent.id, agent.org_id, lib.hash, lib.version, JSON.stringify({ done: 0, total: lib.probes.length, current: null }), trigger]
    );
    const prev = this.perAgent.get(agent.id) || Promise.resolve();
    const job = prev.then(() => this.execute(runId, agent, lib)).catch(() => {});
    this.perAgent.set(agent.id, job);
    job.finally(() => this.perAgent.get(agent.id) === job && this.perAgent.delete(agent.id));
    return { runId, status: 'queued', done: job };
  }

  async execute(runId, agent, lib) {
    const setProgress = (p) =>
      this.db.query(`update runs set progress = $1 where id = $2`, [JSON.stringify(p), runId]);
    try {
      await this.db.query(`update runs set status = 'running', started_at = now() where id = $1`, [runId]);
      await assertProbeable(agent.url);

      const memory = await integration('supermemory', 'recallAgent', { orgId: agent.org_id, agentId: agent.id });
      const collector = new Collector({ targetUrl: agent.url, headers: await openJson(this.db, agent.headers) });
      const inventory = await collector.collectInventory();

      const items = [];
      for (const [i, probe] of lib.probes.entries()) {
        await setProgress({ done: i, total: lib.probes.length, current: probe.id });
        const transcript = probe.kind === 'inventory' ? { turns: [], url: agent.url } : await collector.collect(probe);
        await this.db.query(
          `insert into vendor_requests (id, run_id, probe_id, request_kind, request_body, response_body, status_code, latency_ms)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id('vr'), runId, probe.id, probe.kind || 'turns',
            JSON.stringify(probe.turns || probe.raw || probe.burst || null),
            JSON.stringify(transcript),
            transcript.turns?.[0]?.httpStatus ?? null,
            transcript.turns?.[0]?.latencyMs ?? null,
          ]
        );
        const evidence = buildEvidence({
          probe, transcript, inventory, agentId: agent.id, runId, libraryHash: lib.hash, ts: new Date().toISOString(),
        });
        const entry = await this.ledger.append(agent.id, evidence, { kind: 'evidence', runId });
        items.push({ probe, evidence, finding: renderFinding({ probe, evidence, entry, runId, baseUrl: this.baseUrl }) });
      }
      await setProgress({ done: lib.probes.length, total: lib.probes.length, current: null });
      return await this.finalize(runId, agent, lib, items, memory);
    } catch (err) {
      await this.db.query(`update runs set status = 'failed', error = $1, finished_at = now() where id = $2`, [err.message, runId]);
      await integration('slack', 'send', this.db, agent.org_id, { type: 'run_failed', agentName: agent.name, error: String(err.message).slice(0, 120) });
      throw err;
    }
  }

  // Shared tail of every run: repeat marks, verify chain, sign head, report, notify.
  async finalize(runId, agent, lib, items, memory, { collection } = {}) {
    // Mark findings the org already failed before, so repeat gaps stand out.
    const seenBefore = new Set((memory?.items || []).flatMap((m) => m.probeIds || []));
    for (const it of items) if (it.finding.status === 'fail' && seenBefore.has(it.probe.id)) it.finding.repeat = true;

    const ledgerStatus = await this.ledger.verify(agent.id);
    const ts = new Date().toISOString();
    const signature = await signHead(this.db, {
      agentId: agent.id, runId, head: ledgerStatus.head, length: ledgerStatus.length, libraryHash: lib.hash, ts,
    });
    const report = buildReportCard({ items, agentId: agent.id, runId, library: lib, ledgerStatus, signature, ts, collection });

    await this.db.query(
      `update runs set status = 'completed', grade = $1, report = $2, finished_at = now(), signature = $3 where id = $4`,
      [report.grade, JSON.stringify(report), JSON.stringify(signature), runId]
    );
    const oldGrade = agent.current_grade;
    await this.db.query(
      `update agents set current_grade = $1, last_run_id = $2, last_run_at = now(), updated_at = now() where id = $3`,
      [report.grade, runId, agent.id]
    );

    await integration('supermemory', 'rememberRun', { orgId: agent.org_id, agentId: agent.id, agentName: agent.name, report });
    const ev = { agentName: agent.name, oldGrade, newGrade: report.grade, failed: report.failed, url: `${this.baseUrl}/app/#/agents/${agent.id}/report` };
    if (oldGrade && oldGrade !== report.grade) {
      await integration('keiki', 'notify', {
        orgId: agent.org_id, type: 'grade_change', agentName: agent.name, oldGrade, newGrade: report.grade,
        url: `${this.baseUrl}/a/${agent.id}`,
      });
    }
    const type = !report.ledger?.valid ? 'ledger_broken' : oldGrade && oldGrade !== report.grade ? 'grade_change' : 'run_completed';
    await integration('slack', 'send', this.db, agent.org_id, { ...ev, type });
    return report;
  }

  // ── Hand-collected runs ─────────────────────────────────────────────────
  // For agents with no URL (an app on someone's phone, iMessage). Loxe hands out the probe
  // messages, the owner pastes each reply back, and the same Verifier judges them. Probes that
  // need HTTP access (raw bodies, bursts, endpoint metadata) cannot be done by hand and are
  // recorded as inconclusive. Evidence and the report say the replies were supplied by hand.
  static handable = (p) => (p.kind || 'turns') === 'turns' && (p.turns || []).length > 0;

  async startHand(agent) {
    const lib = loadLibrary(this.libraryPath);
    const runId = id('run');
    const total = lib.probes.filter(Orchestrator.handable).length;
    await this.db.query(
      `insert into runs (id, agent_id, org_id, status, library_hash, library_version, started_at, progress, trigger)
       values ($1, $2, $3, 'awaiting_replies', $4, $5, now(), $6, 'hand')`,
      [runId, agent.id, agent.org_id, lib.hash, lib.version, JSON.stringify({ done: 0, total, current: null })]
    );
    await this.db.query(`update agents set last_run_id = $1, updated_at = now() where id = $2`, [runId, agent.id]);
    return { runId, status: 'awaiting_replies' };
  }

  // The script the owner works through, with replies already saved.
  async handScript(run) {
    const lib = loadLibrary(this.libraryPath);
    if (lib.hash !== run.library_hash) throw new Error('the probe library changed since this run started; start a new run');
    const saved = await this.savedReplies(run.id);
    const steps = lib.probes.filter(Orchestrator.handable).map((p) => ({
      probeId: p.id, title: p.title, category: p.category, severity: p.severity,
      messages: p.turns.map((t) => t.message),
      saved: saved.get(p.id) || null,
    }));
    const skipped = lib.probes.filter((p) => !Orchestrator.handable(p)).map((p) => ({ probeId: p.id, title: p.title }));
    return { runId: run.id, status: run.status, steps, skipped };
  }

  async savedReplies(runId) {
    const rows = (await this.db.query(`select probe_id, response_body from vendor_requests where run_id = $1`, [runId])).rows;
    return new Map(rows.map((r) => [r.probe_id, JSON.parse(r.response_body)]));
  }

  // Save (or replace) the replies for one probe. skip: true records that it was not tried.
  async saveReply(run, probeId, { replies, skip }) {
    const lib = loadLibrary(this.libraryPath);
    const probe = lib.probes.find((p) => p.id === probeId && Orchestrator.handable(p));
    if (!probe) throw Object.assign(new Error('that probe cannot be answered by hand'), { status: 400 });
    let saved;
    if (skip) saved = { skipped: true };
    else {
      const list = (Array.isArray(replies) ? replies : []).map((x) => String(x ?? '').slice(0, 20000));
      if (list.length !== probe.turns.length || list.some((x) => !x.trim()))
        throw Object.assign(new Error(`paste ${probe.turns.length === 1 ? 'the reply' : `all ${probe.turns.length} replies`} first`), { status: 400 });
      saved = { replies: list };
    }
    await this.db.query(`delete from vendor_requests where run_id = $1 and probe_id = $2`, [run.id, probeId]);
    await this.db.query(
      `insert into vendor_requests (id, run_id, probe_id, request_kind, request_body, response_body, status_code, latency_ms)
       values ($1, $2, $3, 'hand', $4, $5, null, null)`,
      [id('vr'), run.id, probeId, JSON.stringify(probe.turns), JSON.stringify(saved)]
    );
    const n = [...(await this.savedReplies(run.id)).values()].filter((x) => x.replies).length;
    const progress = JSON.parse(run.progress || '{}');
    await this.db.query(`update runs set progress = $1 where id = $2`, [JSON.stringify({ ...progress, done: n, current: probeId }), run.id]);
    return { probeId, saved, done: n, total: progress.total };
  }

  // Judge everything saved so far and close the run.
  async finishHand(run, agent) {
    const lib = loadLibrary(this.libraryPath);
    if (lib.hash !== run.library_hash) throw Object.assign(new Error('the probe library changed since this run started; start a new run'), { status: 409 });
    await this.db.query(`update runs set status = 'running' where id = $1 and status = 'awaiting_replies'`, [run.id]);
    try {
      const saved = await this.savedReplies(run.id);
      const memory = await integration('supermemory', 'recallAgent', { orgId: agent.org_id, agentId: agent.id });
      const items = [];
      for (const probe of lib.probes) {
        const s = saved.get(probe.id);
        const transcript = !Orchestrator.handable(probe)
          ? { turns: [], notCollected: 'needs direct access to an endpoint; not testable by hand' }
          : s?.replies
            ? { turns: s.replies.map((text) => ({ text })), collectedBy: 'hand' }
            : { turns: [], notCollected: s?.skipped ? 'skipped by the owner' : 'no reply pasted' };
        const evidence = buildEvidence({
          probe, transcript, inventory: {}, agentId: agent.id, runId: run.id, libraryHash: lib.hash,
          ts: new Date().toISOString(), collection: 'hand',
        });
        const entry = await this.ledger.append(agent.id, evidence, { kind: 'evidence', runId: run.id });
        items.push({ probe, evidence, finding: renderFinding({ probe, evidence, entry, runId: run.id, baseUrl: this.baseUrl }) });
      }
      return await this.finalize(run.id, agent, lib, items, memory, { collection: 'hand' });
    } catch (err) {
      await this.db.query(`update runs set status = 'failed', error = $1, finished_at = now() where id = $2`, [err.message, run.id]);
      throw err;
    }
  }

  // Re-run one probe of a finished run and compare verdicts (the replay mechanism).
  async replay(run, agent, probeId) {
    const lib = loadLibrary(this.libraryPath);
    const probe = lib.probes.find((p) => p.id === probeId);
    if (!probe) throw new Error(`probe ${probeId} is not in library ${lib.version}`);
    await assertProbeable(agent.url);
    const original = (await this.db.query(
      `select response_body from vendor_requests where run_id = $1 and probe_id = $2 limit 1`, [run.id, probeId]
    )).rows[0];
    const collector = new Collector({ targetUrl: agent.url, headers: await openJson(this.db, agent.headers) });
    const inventory = await collector.collectInventory();
    const transcript = probe.kind === 'inventory' ? { turns: [], url: agent.url } : await collector.collect(probe);
    const now = buildEvidence({ probe, transcript, inventory, agentId: agent.id, runId: run.id, libraryHash: lib.hash });
    const report = JSON.parse(run.report || '{}');
    const before = report.findings?.find((f) => f.probeId === probeId);
    return {
      probeId,
      libraryVersion: lib.version,
      sameLibrary: lib.hash === run.library_hash,
      original: before ? { status: before.status, reason: before.engineer.reason } : null,
      now: now.result,
      same: before ? before.status === now.result.status : null,
      originalTranscript: original ? JSON.parse(original.response_body) : null,
      transcript,
    };
  }
}
