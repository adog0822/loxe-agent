// PDF REPORT GENERATOR
// Produces a clearance report PDF from a report card.
// Uses pdfkit. Never claims "certified" or "compliant" —
// only "cleared against X on date Y with evidence Z."
import PDFDocument from 'pdfkit';

const GRADE_COLORS = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
  'N/A': '#6b7280',
};

export function generatePDF(reportCard) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ─────────────────────────────────────────────────────────
    doc.fontSize(24).text('Loxe Clearance Report', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#6b7280')
      .text(`Agent: ${reportCard.agentId}  |  Run: ${reportCard.runId}  |  ${reportCard.ts}`, { align: 'center' });
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor('#6b7280')
      .text(`Library: v${reportCard.libraryVersion} (${reportCard.libraryHash.slice(0, 12)}…)`, { align: 'center' });
    doc.moveDown(1);

    // ── Grade Badge ────────────────────────────────────────────────────
    const gradeColor = GRADE_COLORS[reportCard.grade] || '#6b7280';
    const cx = doc.page.width / 2;
    doc.save();
    doc.circle(cx, doc.y + 30, 30).fill(gradeColor);
    doc.fontSize(28).fillColor('#ffffff')
      .text(reportCard.grade, cx - 14, doc.y + 16, { width: 28, align: 'center' });
    doc.restore();
    doc.y += 70;
    doc.fontSize(12).fillColor('#374151')
      .text(reportCard.gradeSummary, { align: 'center' });
    doc.moveDown(1);

    // ── Summary ────────────────────────────────────────────────────────
    doc.fontSize(11).fillColor('#111827')
      .text(`Total probes: ${reportCard.total}  |  Passed: ${reportCard.passed}  |  Failed: ${reportCard.failed}  |  Inconclusive: ${reportCard.inconclusive}`, { align: 'center' });
    doc.moveDown(1);

    // ── Category Breakdown ─────────────────────────────────────────────
    doc.fontSize(14).fillColor('#111827').text('Category Breakdown');
    doc.moveDown(0.5);
    for (const [key, cat] of Object.entries(reportCard.categories)) {
      if (cat.total === 0) continue;
      doc.fontSize(10).fillColor('#374151')
        .text(`${cat.label}: ${cat.passed}/${cat.total} passed, ${cat.failed} failed, ${cat.inconclusive} inconclusive`);
    }
    doc.moveDown(1);

    // ── Findings Detail ────────────────────────────────────────────────
    doc.fontSize(14).fillColor('#111827').text('Findings');
    doc.moveDown(0.5);
    for (const f of reportCard.findings) {
      const statusIcon = f.status === 'pass' ? '✓' : f.status === 'fail' ? '✗' : '?';
      const statusColor = f.status === 'pass' ? '#22c55e' : f.status === 'fail' ? '#ef4444' : '#6b7280';

      if (doc.y > doc.page.height - 100) doc.addPage();

      doc.fontSize(10).fillColor(statusColor)
        .text(`${statusIcon} [${f.probeId}] ${f.plainEnglish}`, { continued: false });
      doc.fontSize(8).fillColor('#9ca3af')
        .text(`  Severity: ${f.severity} | Category: ${f.category}`);
      doc.moveDown(0.3);
    }

    // ── Controls Coverage ──────────────────────────────────────────────
    if (doc.y > doc.page.height - 120) doc.addPage();
    doc.moveDown(1);
    doc.fontSize(14).fillColor('#111827').text('Controls Coverage');
    doc.moveDown(0.3);
    doc.fontSize(9).fillColor('#374151')
      .text(reportCard.controls.join(', ') || 'None mapped');

    // ── Disclaimer ─────────────────────────────────────────────────────
    doc.moveDown(2);
    doc.fontSize(8).fillColor('#9ca3af')
      .text(
        'This report states that the agent was cleared against the specified probe library on the date shown, ' +
        'with the evidence hashes listed. It does not constitute certification, compliance attestation, or approval ' +
        'by any standards body. Verify the ledger chain independently at the /verify endpoint.',
        { align: 'center' }
      );

    doc.end();
  });
}
