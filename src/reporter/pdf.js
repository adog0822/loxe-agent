// PDF REPORT — the same report-card JSON as the web page, in the order from the plan:
// cover, plain-English summary, adheres to, does not adhere to, remediation by severity,
// evidence appendix (hashes, replay commands, signature). Claims only "cleared against".
import PDFDocument from 'pdfkit';

const INK = '#0d1412';
const MUTE = '#5b6763';
const PROVEN = '#0f9d6b';
const GAP = '#e5452b';
const SEV = { critical: 4, high: 3, medium: 2, low: 1 };

export function generatePDF(report, { agentName, baseUrl }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 56, info: { Title: `Loxe clearance: ${agentName}` } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const h = (t) => { room(60); doc.moveDown(0.8).font('Times-Bold').fontSize(16).fillColor(INK).text(t).moveDown(0.3); };
    const p = (t, o = {}) => doc.font('Helvetica').fontSize(o.size || 10).fillColor(o.color || INK).text(t, o);
    const mono = (t) => doc.font('Courier').fontSize(7.5).fillColor(MUTE).text(t);
    const room = (n) => { if (doc.y > doc.page.height - doc.page.margins.bottom - n) doc.addPage(); };
    const date = report.ts.slice(0, 10);
    const gaps = report.findings.filter((f) => f.status === 'fail').sort((a, b) => SEV[b.severity] - SEV[a.severity]);
    const held = report.findings.filter((f) => f.status === 'pass');
    const untested = report.findings.filter((f) => f.status === 'inconclusive');

    // 1. Cover
    p(agentName, { size: 12, color: MUTE });
    doc.font('Times-Bold').fontSize(96).fillColor(['A', 'B'].includes(report.grade) ? PROVEN : GAP).text(report.grade);
    doc.font('Times-Roman').fontSize(22).fillColor(INK).text(`Cleared against ${report.total} probes on ${date}`);
    p(report.gradeSummary, { color: MUTE }).moveDown(0.6);
    p(`Frameworks: ${report.frameworks.map((f) => `${f.name} (${f.version})`).join('; ')}`, { size: 9, color: MUTE });
    p(`Probe library ${report.libraryName} v${report.libraryVersion}, controls table v${report.controlsVersion}`, { size: 9, color: MUTE });
    p(`Live page: ${baseUrl}/a/${report.agentId}`, { size: 9, color: MUTE, link: `${baseUrl}/a/${report.agentId}` });
    p(`Ledger ${report.ledger.valid ? 'verified' : 'DID NOT verify'} at ${report.ledger.length} entries, head ${report.ledger.head}`, { size: 9, color: report.ledger.valid ? PROVEN : GAP });

    // 2. Plain-English summary
    h('Summary');
    p(`We sent this agent ${report.total} fixed test inputs across five areas. It handled ${report.passed} safely, failed ${report.failed}, and ${report.inconclusive} could not be decided (usually because the agent does not expose its tool calls).`);
    doc.moveDown(0.4);
    for (const c of Object.values(report.categories))
      if (c.total) p(`${c.label}: ${c.passed} held, ${c.failed} gaps, ${c.inconclusive} untested`, { size: 9.5 });

    // 3. Adheres to
    h(`Adheres to (${report.controls.filter((c) => c.status === 'adheres').length} controls)`);
    for (const c of report.controls.filter((x) => x.status === 'adheres')) {
      room(30);
      p(`${c.framework.toUpperCase()} ${c.id}  ${c.title}`, { size: 9.5 });
      p(c.plain, { size: 8.5, color: MUTE });
    }

    // 4. Does not adhere to
    h(`Does not adhere to (${gaps.length} findings)`);
    if (!gaps.length) p('No failed probes.', { color: MUTE });
    for (const f of gaps) {
      room(70);
      p(`${f.probeId}  ${f.title}  (${f.severity})`, { size: 10.5, color: GAP });
      p(f.plainEnglish, { size: 9 });
      p(`Engineer: ${f.engineer.reason}`, { size: 8.5, color: MUTE });
      p(`Auditor: ${f.auditor.controls.map((c) => `${c.framework.toUpperCase()} ${c.id}`).join(', ')}`, { size: 8.5, color: MUTE });
      if (f.decision) p(`Decision: ${f.decision.state} by ${f.decision.by} ${f.decision.note ? `(${f.decision.note})` : ''}`, { size: 8.5, color: MUTE });
      doc.moveDown(0.4);
    }
    if (untested.length) {
      h(`Untested (${untested.length})`);
      for (const f of untested) p(`${f.probeId}  ${f.title}: ${f.engineer.reason}`, { size: 9, color: MUTE });
    }

    // 5. Remediation plan
    h('Remediation plan');
    const fixes = gaps.filter((f) => f.engineer.remediation);
    if (!fixes.length) p('Nothing to fix.', { color: MUTE });
    fixes.forEach((f, i) => {
      room(50);
      p(`${i + 1}. ${f.probeId} (${f.severity}): ${f.engineer.remediation.summary}`, { size: 9.5 });
      if (f.engineer.remediation.patch) mono(f.engineer.remediation.patch);
      doc.moveDown(0.3);
    });

    // 6. Evidence appendix
    doc.addPage();
    h('Evidence appendix');
    p('Each line is one ledger entry. Recompute any hash from the exported ledger, or paste it at the verify endpoint.', { size: 9, color: MUTE });
    p(`Export: ${baseUrl}/ledger/${report.agentId}/export   Verify: ${baseUrl}/verify?hash=<hash>`, { size: 8.5, color: MUTE }).moveDown(0.4);
    for (const f of [...gaps, ...held, ...untested]) {
      room(28);
      p(`${f.probeId} ${f.status}  seq ${f.auditor.evidence.ledgerSeq}`, { size: 8.5 });
      mono(`payload ${f.auditor.evidence.hash}  transcript ${f.auditor.evidence.transcriptHash}`);
    }
    if (report.signature) {
      h('Signature');
      mono(`${report.signature.alg} key ${report.signature.keyId}\n${report.signature.signature}`);
      p(`Public key: ${baseUrl}/.well-known/loxe-signing-key`, { size: 8.5, color: MUTE });
    }
    doc.moveDown(1);
    p(report.disclaimer, { size: 8, color: MUTE });
    doc.end();
  });
}
