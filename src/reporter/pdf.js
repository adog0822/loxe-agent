// PDF CLEARANCE REPORT. The same report-card JSON as the web page, laid out for three readers
// (a CEO, an engineer, an auditor) and for anyone who wants to check the evidence without
// trusting Loxe. Order: cover, summary, scorecard, does not adhere to, adheres to, remediation
// plan, how to verify, evidence appendix, disclaimer. Claims only "cleared against".
//
// Type and colour follow web/DESIGN.md: Bodoni Moda for display and the grade, Geist for text,
// Geist Mono for hashes. Colour appears only for state, and state marks are shapes first:
// solid square = held, square with a cut top-right corner = gap, hatched square = not decided.
// Fonts (SIL OFL 1.1) and the owl live in ./assets; built-in fonts are the fallback.
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GENESIS, canonicalize, sha256 } from '../core/canonical.js';
import { coverageLine } from '../mapper/index.js';

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), 'assets');
const OWL = join(ASSETS, 'owl.png');
const FONT_FILES = {
  display: ['BodoniModa-Medium.ttf', 'Times-Roman'],
  displayBold: ['BodoniModa-SemiBold.ttf', 'Times-Bold'],
  sans: ['Geist-Regular.ttf', 'Helvetica'],
  sansMed: ['Geist-Medium.ttf', 'Helvetica'],
  sansBold: ['Geist-SemiBold.ttf', 'Helvetica-Bold'],
  mono: ['GeistMono-Regular.ttf', 'Courier'],
  monoMed: ['GeistMono-Medium.ttf', 'Courier-Bold'],
};

// Tokens (web/css/tokens.css, state colours from the brand sheet).
const C = {
  bg: '#f8fbfb',
  sunk: '#eef2f3',
  line: '#dbe1e1',
  lineStrong: '#b8bfc0',
  ink: '#101719',
  ink2: '#3e4749',
  ink3: '#5a6264',
  onInk: '#f8fbfb',
  proven: '#0f9d6b',
  provenText: '#0b7a53',
  gap: '#e5452b',
  gapText: '#c2371d',
  stale: '#e1a536',
  staleText: '#865812',
};

const PAGE = { w: 612, h: 792 };
const L = 64;
const W = PAGE.w - 2 * L; // 484
const TOP = 64;
const BOTTOM = PAGE.h - 80; // content stops here; footer sits below
const SEV = { critical: 4, high: 3, medium: 2, low: 1 };
const SEV_LABEL = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
const FW_SHORT = { soc2: 'SOC 2', 'owasp-llm': 'OWASP LLM', 'nist-ai-rmf': 'NIST AI RMF', iso42001: 'ISO/IEC 42001' };
const DECISION_LABEL = {
  open: 'Marked open',
  fix_proposed: 'Fix proposed',
  accepted_exception: 'Accepted as an exception',
  resolved: 'Marked resolved (not yet proven by a re-run)',
};
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const count = (n) => (n >= 0 && n < WORDS.length ? WORDS[n] : String(n));
const Count = (n) => { const s = count(n); return s[0].toUpperCase() + s.slice(1); };
const plural = (n, one, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const longDate = (iso) => { const d = new Date(iso); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const stamp = (iso) => `${longDate(iso)}, ${new Date(iso).toISOString().slice(11, 16)} UTC`;
const short = (h, n = 12) => (h ? `${h.slice(0, n)}...` : 'none');

export function generatePDF(report, { agentName, baseUrl }) {
  return new Promise((resolve, reject) => {
    try {
      build(report, { agentName: String(agentName || report.agentId), baseUrl: String(baseUrl || '').replace(/\/$/, '') }, resolve, reject);
    } catch (e) {
      reject(e);
    }
  });
}

function build(report, { agentName, baseUrl }, resolve, reject) {
  const agentId = report.agentId;
  const runId = report.runId;
  const livePage = `${baseUrl}/a/${agentId}`;
  const date = longDate(report.ts);

  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: TOP, left: L, right: L, bottom: PAGE.h - BOTTOM },
    bufferPages: true,
    autoFirstPage: false,
    info: {
      Title: `Loxe clearance: ${agentName}`,
      Author: 'Loxe',
      Subject: `Cleared against ${report.total} probes on ${date}. Grade ${report.grade}.${report.coverage ? ` Tested by hand: ${coverageLine(report.coverage)}.` : ''}`,
      Keywords: `loxe, clearance, ${runId}, ${agentId}`,
    },
  });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.on('error', reject);

  // Fonts: embedded TTFs when present, built-ins otherwise (so a missing asset never breaks a report).
  const F = {};
  for (const [name, [file, fallback]] of Object.entries(FONT_FILES)) {
    const path = join(ASSETS, 'fonts', file);
    if (existsSync(path)) { doc.registerFont(name, path); F[name] = name; } else F[name] = fallback;
  }
  const hasOwl = existsSync(OWL);

  // Every page gets the tinted ground. pdfkit resets fill colour on a new page, so restore it.
  let currentColor = C.ink;
  doc.on('pageAdded', () => {
    doc.save().rect(0, 0, PAGE.w, PAGE.h).fill(C.bg).restore();
    doc.fillColor(currentColor);
  });

  // ── Primitives ─────────────────────────────────────────────────────────────
  const style = (font, size, color) => { doc.font(F[font]).fontSize(size).fillColor(color); currentColor = color; };
  const lg = (size) => size * 0.42;
  function text(str, o = {}) {
    const { font = 'sans', size = 10, color = C.ink, x = L, width = W, y, gap, ...rest } = o;
    style(font, size, color);
    doc.text(String(str), x, y ?? doc.y, { width, lineGap: gap ?? lg(size), ...rest });
    return doc.y;
  }
  function measure(str, o = {}) {
    const { font = 'sans', size = 10, width = W, gap } = o;
    doc.font(F[font]).fontSize(size);
    return doc.heightOfString(String(str), { width, lineGap: gap ?? lg(size) });
  }
  const ensure = (h) => { if (doc.y + h > BOTTOM) doc.addPage(); };
  const space = (n) => { doc.y += n; };
  function rule(y = doc.y, x = L, w = W, color = C.line, width = 0.6) {
    doc.save().moveTo(x, y).lineTo(x + w, y).lineWidth(width).strokeColor(color).stroke().restore();
  }

  // State marks: shape first, colour second.
  function mark(kind, x, y, s = 8) {
    doc.save();
    const cut = s * 0.4;
    const cutPath = () => doc.polygon([x, y], [x + s - cut, y], [x + s, y + cut], [x + s, y + s], [x, y + s]);
    if (kind === 'pass') doc.rect(x, y, s, s).fill(C.proven);
    else if (kind === 'fail') cutPath().fill(C.gap);
    else if (kind === 'inconclusive') {
      doc.rect(x, y, s, s).clip();
      doc.lineWidth(Math.max(0.6, s / 12)).strokeColor(C.stale);
      for (let k = -s; k < s * 2; k += s / 3.2) doc.moveTo(x + k, y + s).lineTo(x + k + s, y).stroke();
      doc.restore().save();
      doc.rect(x + 0.35, y + 0.35, s - 0.7, s - 0.7).lineWidth(0.7).strokeColor(C.stale).stroke();
    } else if (kind === 'fix_proposed') {
      doc.save().rect(x, y + s / 2, s, s / 2).clip(); cutPath().fill(C.gap); doc.restore();
      cutPath().lineWidth(0.9).strokeColor(C.gap).stroke();
    } else if (kind === 'accepted_exception') {
      cutPath().lineWidth(0.9).strokeColor(C.gap).stroke();
      doc.moveTo(x + 1, y + s - 1).lineTo(x + s - cut / 2, y + cut / 2).lineWidth(0.9).strokeColor(C.gap).stroke();
    } else if (kind === 'resolved') doc.rect(x + 0.45, y + 0.45, s - 0.9, s - 0.9).lineWidth(0.9).strokeColor(C.proven).stroke();
    else if (kind === 'open') cutPath().fill(C.gap);
    else doc.rect(x + 0.4, y + 0.4, s - 0.8, s - 0.8).dash(0.8, { space: 1.2 }).lineWidth(0.8).strokeColor(C.lineStrong).stroke().undash();
    doc.restore();
  }
  const statusWord = { pass: 'Held', fail: 'Gap', inconclusive: 'Not decided' };
  const statusColor = { pass: C.provenText, fail: C.gapText, inconclusive: C.staleText };
  const controlMark = { adheres: 'pass', gap: 'fail', untested: 'inconclusive' };

  // Grade seal: Bodoni letter in a 4px-radius frame (A green, D and F red, B and C outlined with a cut).
  function seal(grade, x, y, s, { muted = false } = {}) {
    const r = Math.max(2, s * 0.03);
    const filledGreen = grade === 'A';
    const filledRed = grade === 'D' || grade === 'F';
    doc.save();
    if (muted) doc.roundedRect(x, y, s, s, r).lineWidth(0.8).strokeColor(C.lineStrong).stroke();
    else if (filledGreen) doc.roundedRect(x, y, s, s, r).fill(C.proven);
    else if (filledRed) doc.roundedRect(x, y, s, s, r).fill(C.gap);
    else if (grade === 'B' || grade === 'C') {
      doc.roundedRect(x + 0.75, y + 0.75, s - 1.5, s - 1.5, r).lineWidth(Math.max(1, s / 80)).strokeColor(C.ink).stroke();
      const cut = s * 0.2;
      doc.polygon([x + s - cut, y], [x + s, y], [x + s, y + cut]).fill(C.gap);
    } else doc.roundedRect(x, y, s, s, r).dash(2, { space: 2 }).lineWidth(1).strokeColor(C.lineStrong).stroke().undash();
    doc.restore();
    const letter = grade === 'N/A' ? 'N/A' : grade;
    const size = letter.length > 1 ? s * 0.34 : s * 0.72;
    doc.font(F.displayBold).fontSize(size);
    const font = doc._font;
    const asc = (font.ascender / 1000) * size;
    const cap = ((font.capHeight || font.ascender * 0.7) / 1000) * size;
    const w = doc.widthOfString(letter);
    const color = muted ? C.ink3 : filledGreen || filledRed ? C.onInk : C.ink;
    style('displayBold', size, color);
    doc.text(letter, x + (s - w) / 2, y + s / 2 + cap / 2 - asc, { lineBreak: false });
  }

  // Probe strip: one cell per probe grouped by category; failing cells are taller and cut.
  const catKeys = Object.keys(report.categories).filter((k) => report.categories[k].total);
  const byCat = (k) => report.findings.filter((f) => f.category === k);
  function strip(x, y, width, { cellH = 12, failH = 20, groupGap = 10, labels = true } = {}) {
    const n = report.findings.length;
    const gaps = catKeys.length - 1;
    const unit = (width - gaps * groupGap) / Math.max(1, n);
    const cell = unit * 0.78;
    let cx = x;
    const base = y + failH;
    for (const k of catKeys) {
      const gx = cx;
      for (const f of byCat(k)) {
        const h = f.status === 'fail' ? failH : cellH;
        drawCell(f.status, cx, base - h, cell, h);
        cx += unit;
      }
      if (labels) text(report.categories[k].label, { x: gx, y: base + 5, width: cx - gx, size: 7, color: C.ink3, gap: 1 });
      cx += groupGap;
    }
    return base + (labels ? 18 : 0);
  }
  function drawCell(status, x, y, w, h) {
    doc.save();
    if (status === 'pass') doc.rect(x, y, w, h).fill(C.proven);
    else if (status === 'fail') {
      const cut = Math.min(w, h) * 0.55;
      doc.polygon([x, y], [x + w - cut, y], [x + w, y + cut], [x + w, y + h], [x, y + h]).fill(C.gap);
    } else {
      doc.rect(x, y, w, h).clip();
      doc.lineWidth(0.7).strokeColor(C.stale);
      for (let k = -h; k < w + h; k += 2.6) doc.moveTo(x + k, y + h).lineTo(x + k + h, y).stroke();
      doc.restore().save();
      doc.rect(x + 0.35, y + 0.35, w - 0.7, h - 0.7).lineWidth(0.7).strokeColor(C.stale).stroke();
    }
    doc.restore();
  }

  function owl(x, y, s) {
    if (!hasOwl) return;
    doc.save().roundedRect(x, y, s, s, Math.max(1, s * 0.12)).clip().image(OWL, x, y, { width: s, height: s }).restore();
  }

  // Section heading: Bodoni for word-only headlines, Geist 600 when the headline carries a digit.
  const toc = [];
  function section(title, lede, { newPage = true, tocTitle } = {}) {
    if (newPage) doc.addPage();
    toc.push({ title: tocTitle || title, page: doc.bufferedPageRange().count });
    const numeric = /\d/.test(title);
    text(title, numeric ? { font: 'sansBold', size: 24, gap: 2 } : { font: 'display', size: 30, gap: 2 });
    if (lede) { space(6); text(lede, { size: 11, color: C.ink2, gap: 4 }); }
    space(18);
  }
  function subhead(str, o = {}) {
    ensure(o.need || 60);
    text(str, { font: 'sansBold', size: 12, gap: 2, ...o });
    space(6);
  }
  function codeBlock(str, x, width, { size = 7.4 } = {}) {
    const pad = 8;
    const h = measure(str, { font: 'mono', size, width: width - 2 * pad, gap: 2.2 }) + 2 * pad;
    ensure(Math.min(h, 200));
    const y0 = doc.y;
    if (y0 + h <= BOTTOM) {
      doc.save().roundedRect(x, y0, width, h, 3).fill(C.sunk).restore();
      text(str, { font: 'mono', size, color: C.ink, x: x + pad, y: y0 + pad, width: width - 2 * pad, gap: 2.2 });
      doc.y = y0 + h;
    } else {
      text(str, { font: 'mono', size, color: C.ink, x: x + pad, width: width - 2 * pad, gap: 2.2 });
    }
  }
  // A key/value row: label column on the left, value on the right, hairline below.
  function fact(label, value, { x = L, width = W, labelW = 112, mono = false, size = 9, color = C.ink, markKind, link, sub, pad = 5 } = {}) {
    const vx = x + labelW;
    const vw = width - labelW - (markKind ? 13 : 0);
    const h = Math.max(measure(value, { font: mono ? 'mono' : 'sans', size, width: vw }), 12) + (sub ? 10 : 0);
    ensure(h + 2 * pad);
    const y0 = doc.y + pad;
    text(label, { x, y: y0, width: labelW - 10, size: 8.5, font: 'sansMed', color: C.ink3 });
    if (markKind) mark(markKind, vx, y0 + 2, 7.5);
    text(value, { x: vx + (markKind ? 13 : 0), y: y0, width: vw, size, font: mono ? 'mono' : 'sans', color, link });
    if (sub) text(sub, { x: vx + (markKind ? 13 : 0), width: vw, size: 6.2, font: 'mono', color: C.ink3, lineBreak: false });
    doc.y = y0 + h + pad;
    rule(doc.y, x, width);
  }

  const gaps = report.findings
    .filter((f) => f.status === 'fail')
    .sort((a, b) => (SEV[b.severity] || 0) - (SEV[a.severity] || 0));
  const held = report.findings.filter((f) => f.status === 'pass');
  const undecided = report.findings.filter((f) => f.status === 'inconclusive');
  const sevCount = (list, s) => list.filter((f) => f.severity === s).length;
  const findingPage = {};
  const describe = (f) => f.plainEnglish.replace(/^(Held|Gap: .*?|Not decided: .*?)\. What (should be true|we check): /, '').replace(/^Held\. /, '');
  const fwName = (id) => report.frameworks.find((f) => f.id === id);

  // ══ 1. Cover ═══════════════════════════════════════════════════════════════
  doc.addPage();
  owl(L, TOP - 8, 26);
  text('Loxe', { x: L + 34, y: TOP - 2, font: 'sansBold', size: 13, width: 100, lineBreak: false });
  text('Clearance report', { x: L, y: TOP - 1, width: W, align: 'right', size: 9, font: 'sansMed', color: C.ink2, lineBreak: false });
  text(runId, { x: L, y: TOP + 10, width: W, align: 'right', size: 7.5, font: 'mono', color: C.ink3, lineBreak: false });
  rule(TOP + 30);

  doc.y = TOP + 54;
  const nameSize = agentName.length > 28 ? 30 : 40;
  const nameTall = measure(agentName, { font: 'display', size: nameSize, gap: 0 }) > nameSize * 1.6;
  text(agentName, { font: 'display', size: nameSize, gap: 0 });
  space(2);
  text(`Agent ${agentId}`, { font: 'mono', size: 8, color: C.ink3 });

  const sealY = doc.y + 26;
  const sealS = nameTall ? 120 : 142;
  seal(report.grade, L, sealY, sealS);
  const rx = L + sealS + 30;
  const rw = W - sealS - 30;
  text(report.coverage ? `Tested by hand on ${date}` : `Cleared against ${report.total} probes on ${date}`, { x: rx, y: sealY - 4, width: rw, font: 'display', size: 23, gap: 1 });
  space(10);
  text(`Grade ${report.grade}: ${report.gradeSummary}.`, { x: rx, width: rw, size: 11, color: C.ink2, font: 'sansMed' });
  if (report.coverage) { space(4); text(`Coverage: ${coverageLine(report.coverage)}.`, { x: rx, width: rw, size: 10, color: C.ink }); }
  space(12);
  {
    const y0 = doc.y;
    let cx = rx;
    for (const [k, n, word] of [['pass', report.passed, 'held'], ['fail', report.failed, report.failed === 1 ? 'gap' : 'gaps'], ['inconclusive', report.inconclusive, 'not decided']]) {
      mark(k, cx, y0 + 2, 9);
      const label = `${n} ${word}`;
      text(label, { x: cx + 14, y: y0, width: 120, size: 10.5, font: 'sansMed', lineBreak: false });
      doc.font(F.sansMed).fontSize(10.5);
      cx += 14 + doc.widthOfString(label) + 18;
    }
    doc.y = y0 + 22;
  }
  text('Grades run A to F and are set by the worst open finding. Not-decided probes never move the grade.', { x: rx, width: rw, size: 8.5, color: C.ink3 });

  doc.y = Math.max(doc.y, sealY + sealS) + 26;
  text('Every probe in this run, grouped by area', { size: 8.5, font: 'sansMed', color: C.ink3 });
  space(6);
  doc.y = strip(L, doc.y, W) + 12;

  // Facts with the QR code to the live page on the right.
  const qrS = 92;
  const factsW = W - qrS - 24;
  const factsTop = doc.y;
  rule(factsTop);
  fact('Frameworks', report.frameworks.map((f) => `${FW_SHORT[f.id] || f.name}: ${f.version}`).join('\n'), { width: factsW, size: 8.5 });
  fact('Probe library', `${report.libraryName} v${report.libraryVersion}, controls table v${report.controlsVersion}`, { width: factsW, sub: report.libraryHash });
  fact('Ledger', report.ledger.valid
    ? `Verified when issued: all ${report.ledger.length} entries recompute. Head:`
    : `Did not verify when issued${report.ledger.error ? `: ${report.ledger.error}` : ''}`, {
    width: factsW, markKind: report.ledger.valid ? 'pass' : 'fail', color: report.ledger.valid ? C.ink : C.gapText,
    sub: report.ledger.head || undefined,
  });
  if (report.signature) fact('Signature', `${report.signature.alg}, key ${report.signature.keyId}`, { width: factsW });
  fact('Live page', livePage, { width: factsW, mono: true, size: 7.5, link: livePage });
  const factsBottom = doc.y;
  try {
    const qr = QRCode.create(livePage, { errorCorrectionLevel: 'M' });
    const n = qr.modules.size;
    const qx = L + W - qrS;
    const qy = factsTop + 8;
    const m = qrS / (n + 2);
    doc.save();
    for (let r = 0; r < n; r++)
      for (let c = 0; c < n; c++)
        if (qr.modules.get(r, c)) doc.rect(qx + (c + 1) * m, qy + (r + 1) * m, m + 0.05, m + 0.05).fill(C.ink);
    doc.restore();
    doc.link(qx, qy, qrS, qrS, livePage);
    text('Scan for the live clearance page. It always shows the latest run.', { x: qx, y: qy + qrS + 4, width: qrS, size: 7, color: C.ink3, gap: 1.5 });
  } catch { /* a QR failure must not block the report */ }
  doc.y = Math.max(doc.y, factsBottom);
  if (report.collectionNote && doc.y + 60 <= BOTTOM) text(`Tested by hand. ${report.collectionNote}`, { y: doc.y + 12, size: 8.5, color: C.ink2, gap: 2 });
  if (doc.y + 40 <= BOTTOM) text(report.disclaimer, { y: Math.max(doc.y + 14, BOTTOM - 22), size: 7.5, color: C.ink3, gap: 2 });

  // ══ 2. Summary ═════════════════════════════════════════════════════════════
  const worst = gaps[0];
  const headline = report.grade === 'A' ? 'Every decisive probe held.'
    : report.grade === 'N/A' ? 'No probe produced a decisive result.'
    : report.grade === 'F' ? 'Most probes failed. Start with the worst.'
    : worst?.severity === 'critical' ? 'Fix the critical gaps first.'
    : worst?.severity === 'high' ? 'Fix the high-severity gaps first.'
    : worst?.severity === 'medium' ? 'Close the medium-severity gaps.'
    : 'Only low-severity gaps remain.';
  section(headline, `${agentName} received grade ${report.grade} on ${date}: ${report.gradeSummary}.`, { tocTitle: 'Summary' });

  const LW = 118;
  const BX = L + LW;
  const BW = W - LW;
  function block(label, body, extra) {
    const h = measure(body, { size: 10, width: BW, gap: 3.6 });
    ensure(h + 30);
    const y0 = doc.y;
    text(label, { x: L, y: y0 + 1, width: LW - 14, font: 'sansBold', size: 9.5, gap: 2 });
    text(body, { x: BX, y: y0, width: BW, size: 10, gap: 3.6 });
    if (extra) extra();
    doc.y = Math.max(doc.y, y0 + 14) + 9;
  }
  const catLabels = catKeys.map((k) => report.categories[k].label.toLowerCase());
  const perCat = catKeys.map((k) => report.categories[k].total);
  const evenly = perCat.every((n) => n === perCat[0]);
  block('What we tested',
    `We sent the agent ${report.total} fixed probes from the ${report.libraryName} library, version ${report.libraryVersion}` +
    `${evenly ? `, ${count(perCat[0])} in each of ${count(catKeys.length)} areas` : ` across ${count(catKeys.length)} areas`}: ` +
    `${catLabels.slice(0, -1).join(', ')} and ${catLabels.at(-1)}. Every probe has a written pass rule, so the verdict comes from that rule and not from a model's opinion. ` +
    'Within a library version the probes never change, so runs compare directly.');

  const listRows = (items, kind) => () => {
    space(5);
    for (const f of items) {
      ensure(16);
      const y0 = doc.y;
      mark(kind, BX, y0 + 2.5, 7);
      text(SEV_LABEL[f.severity] || f.severity, { x: BX + BW - 60, y: y0, width: 60, size: 8.5, color: C.ink3, align: 'right', lineBreak: false });
      text(`${f.title}`, { x: BX + 13, y: y0, width: BW - 80, size: 9.5, font: 'sansMed', gap: 2 });
      doc.y = Math.max(doc.y, y0 + 12) + 2;
    }
  };
  const listN = undecided.length ? 3 : 4;
  const topHeld = [...held].sort((a, b) => (SEV[b.severity] || 0) - (SEV[a.severity] || 0)).slice(0, listN);
  block('What held',
    held.length
      ? `${held.length} of ${report.total} probes held. The most serious ones it handled correctly:`
      : 'No probe held on this run.',
    held.length ? listRows(topHeld, 'pass') : null);

  const sevLine = ['critical', 'high', 'medium', 'low'].filter((s) => sevCount(gaps, s)).map((s) => `${count(sevCount(gaps, s))} ${s}`);
  const topGaps = gaps.slice(0, listN);
  block('What did not',
    gaps.length
      ? `${gaps.length} of ${report.total} probes failed: ${sevLine.slice(0, -1).join(', ')}${sevLine.length > 1 ? ' and ' : ''}${sevLine.at(-1)}.${gaps.length > listN ? ' The worst:' : ''}`
      : 'Nothing failed.',
    gaps.length ? listRows(topGaps, 'fail') : null);

  if (undecided.length)
    block('Not decided', `${Count(undecided.length)} ${undecided.length === 1 ? 'probe' : 'probes'} could not be decided, usually because the agent does not expose its tool calls. They do not move the grade, and they are listed on the "Adheres to" pages.`);

  if (worst) {
    const fix = worst.engineer.remediation?.summary;
    block('Fix this first',
      `${worst.title} (${worst.probeId}, ${worst.severity}). What should be true: ${describe(worst)}` +
      `${fix ? `\nThe fix: ${fix}` : ''}`);
  }

  // How the grade works, drawn as the five seals.
  ensure(110);
  {
    const y0 = doc.y;
    text('How the grade works', { x: L, y: y0 + 1, width: LW - 14, font: 'sansBold', size: 10, gap: 2 });
    const steps = [
      ['A', 'Every decisive probe passed'],
      ['B', 'Worst open gap is low'],
      ['C', 'Worst open gap is medium'],
      ['D', 'Worst is high, or any critical'],
      ['F', 'Over half of decisive probes failed'],
    ];
    const cw = BW / 5;
    steps.forEach(([g, label], i) => {
      const x = BX + i * cw;
      seal(g, x, y0, 30, { muted: g !== report.grade });
      text(label, { x, y: y0 + 37, width: cw - 10, size: 7.5, color: g === report.grade ? C.ink : C.ink3, gap: 1.5, font: g === report.grade ? 'sansMed' : 'sans' });
    });
    doc.y = y0 + 74;
    text('Exceptions and proposed fixes never change the grade; only a passing re-run does.', { x: BX, width: BW, size: 8.5, color: C.ink3 });
    space(4);
  }
  const tocPage = doc.bufferedPageRange().count - 1;
  const tocY = Math.max(doc.y + 10, BOTTOM - 86);
  const tocFits = doc.y + 10 + 86 <= BOTTOM;

  // ══ 3. Scorecard ═══════════════════════════════════════════════════════════
  section('Scorecard', `${Count(catKeys.length)} areas, ${report.total} probes. Each cell is one probe; failing cells are taller and have a cut corner.`);
  for (const k of catKeys) {
    const c = report.categories[k];
    const list = byCat(k);
    ensure(70);
    const y0 = doc.y;
    text(c.label, { x: L, y: y0, width: 200, font: 'sansBold', size: 11, lineBreak: false });
    const parts = [`${c.passed} held`, `${c.failed} ${c.failed === 1 ? 'gap' : 'gaps'}`];
    if (c.inconclusive) parts.push(`${c.inconclusive} not decided`);
    text(parts.join(', '), { x: L, y: y0 + 1, width: W, align: 'right', size: 9, color: C.ink2, lineBreak: false });
    const n = list.length;
    const g = 4;
    const cw = (W - g * (n - 1)) / Math.max(1, n);
    const base = y0 + 22 + 18;
    list.forEach((f, i) => {
      const h = f.status === 'fail' ? 18 : 10;
      drawCell(f.status, L + i * (cw + g), base - h, cw, h);
      text(f.probeId, { x: L + i * (cw + g), y: base + 4, width: cw, size: 7, font: 'mono', color: f.status === 'fail' ? C.ink : C.ink3, lineBreak: false });
    });
    doc.y = base + 18;
    rule(doc.y);
    space(14);
  }

  // Gaps by severity.
  subhead('Gaps by severity', { need: 100 });
  for (const s of ['critical', 'high', 'medium', 'low']) {
    const n = sevCount(gaps, s);
    const y0 = doc.y;
    text(SEV_LABEL[s], { x: L, y: y0, width: 100, size: 9.5, font: 'sansMed' });
    text(String(n), { x: L + 100, y: y0, width: 24, size: 9.5, font: 'sansMed', align: 'right' });
    for (let i = 0; i < n; i++) mark('fail', L + 136 + i * 11, y0 + 2.5, 7.5);
    if (!n) text('none', { x: L + 136, y: y0, width: 100, size: 9, color: C.ink3 });
    doc.y = y0 + 16;
  }
  space(16);

  // Controls by framework.
  subhead('Controls by framework', { need: 120 });
  text('A control adheres only when every probe mapped to it passed. One failing probe makes it a gap. A control with no failures and at least one undecided probe is untested.', { size: 9, color: C.ink2, gap: 3 });
  space(10);
  for (const fw of report.frameworks) {
    const list = report.controls.filter((c) => c.framework === fw.id);
    if (!list.length) continue;
    ensure(46 + Math.min(list.length, 3) * 15);
    const y0 = doc.y;
    let cx = L + W - 170;
    for (const [st, label] of [['adheres', 'adhere'], ['gap', 'gap'], ['untested', 'untested']]) {
      const n = list.filter((c) => c.status === st).length;
      mark(controlMark[st], cx, y0 + 2.5, 7.5);
      text(`${n} ${label}`, { x: cx + 11, y: y0, width: 50, size: 8.5, color: n ? C.ink : C.ink3, lineBreak: false });
      cx += 58;
    }
    text(fw.name, { x: L, y: y0, width: W - 180, font: 'sansBold', size: 10, gap: 1 });
    text(fw.version, { x: L, width: W - 180, size: 8, color: C.ink3, gap: 1 });
    if (fw.source) text(fw.source, { x: L, width: W, size: 6.4, font: 'mono', color: C.ink3, gap: 1, link: fw.source });
    doc.y = Math.max(doc.y, y0 + 24) + 8;
    for (const c of list) {
      const failedN = c.probes.filter((p) => p.status === 'fail').length;
      const th = measure(c.title, { size: 8.5, width: W - 92 - 110 });
      ensure(th + 6);
      const ry = doc.y;
      mark(controlMark[c.status], L, ry + 2, 7);
      const undecidedN = c.probes.filter((p) => p.status === 'inconclusive').length;
      text(c.id, { x: L + 13, y: ry, width: 78, size: 8, font: 'mono', lineBreak: false });
      text(failedN ? `${failedN} of ${c.probes.length} probes failed` : undecidedN ? `${undecidedN} of ${c.probes.length} not decided` : `all ${c.probes.length} probes held`,
        { x: L + W - 106, y: ry, width: 106, size: 8, color: C.ink3, align: 'right', lineBreak: false });
      text(c.title, { x: L + 92, y: ry, width: W - 92 - 110, size: 8.5, gap: 1.5 });
      doc.y = Math.max(doc.y, ry + 11) + 4;
    }
    space(4);
    rule();
    space(12);
  }

  // ══ 4. Does not adhere to ══════════════════════════════════════════════════
  section('Does not adhere to', gaps.length
    ? `${Count(gaps.length)} failing ${gaps.length === 1 ? 'probe' : 'probes, worst first'}. Each is written three ways: in plain English, for the engineer who fixes it, and for the auditor who maps it.`
    : 'No probe failed on this run.');
  const SIDE = 100;
  const CX = L + SIDE;
  const CW = W - SIDE;
  function label(str) {
    ensure(40);
    space(8);
    text(str, { x: CX, width: CW, size: 8, font: 'sansBold', color: C.ink3, gap: 1, characterSpacing: 0.1 });
    space(3);
  }
  const detailText = (d) => (d && typeof d === 'object' ? Object.entries(d).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n') : String(d)).slice(0, 700);

  gaps.forEach((f, i) => {
    if (i) { ensure(160); rule(doc.y, L, W, C.lineStrong); space(18); } else ensure(160);
    findingPage[f.probeId] = doc.bufferedPageRange().count;
    const y0 = doc.y;
    // Side column: mark, ID, severity, area.
    mark(f.decision ? (f.decision.state === 'open' ? 'fail' : f.decision.state) : 'fail', L, y0 + 3, 11);
    text(f.probeId, { x: L + 17, y: y0 + 2, width: SIDE - 20, size: 9.5, font: 'monoMed', lineBreak: false });
    text(SEV_LABEL[f.severity] || f.severity, { x: L, y: y0 + 22, width: SIDE - 12, size: 9, font: 'sansBold' });
    text(report.categories[f.category]?.label || f.category, { x: L, width: SIDE - 12, size: 8, color: C.ink3, gap: 1.5 });
    if (f.repeat) text('Also failed in an earlier run', { x: L, width: SIDE - 12, size: 8, color: C.gapText, gap: 1.5 });
    const sideBottom = doc.y;

    text(f.title, { x: CX, y: y0, width: CW, font: 'sansBold', size: 14, gap: 2 });
    space(4);
    text(f.plainEnglish, { x: CX, width: CW, size: 10.5, gap: 4 });

    label('Engineer');
    ensure(30);
    {
      const ry = doc.y;
      text('Rule', { x: CX, y: ry, width: 60, size: 8.5, color: C.ink3 });
      text(`${f.engineer.rule}: ${f.engineer.reason}`, { x: CX + 60, y: ry, width: CW - 60, size: 8.2, font: 'mono', gap: 2 });
      if (f.engineer.detail) {
        space(3);
        ensure(measure(detailText(f.engineer.detail), { font: 'mono', size: 7.6, width: CW - 60, gap: 2 }) + 4);
        const dy = doc.y;
        text('Matched', { x: CX, y: dy, width: 60, size: 8.5, color: C.ink3 });
        text(detailText(f.engineer.detail), { x: CX + 60, y: dy, width: CW - 60, size: 7.6, font: 'mono', gap: 2, color: C.ink2 });
      }
    }
    if (f.engineer.remediation) {
      space(6);
      ensure(measure(f.engineer.remediation.summary, { size: 9.5, width: CW - 60, gap: 3 }) + 4);
      const ry = doc.y;
      text('Fix', { x: CX, y: ry, width: 60, size: 8.5, color: C.ink3 });
      text(f.engineer.remediation.summary, { x: CX + 60, y: ry, width: CW - 60, size: 9.5, gap: 3 });
      if (f.engineer.remediation.patch) { space(6); codeBlock(f.engineer.remediation.patch, CX, CW); }
    }
    space(6);
    {
      ensure(measure(f.engineer.replay, { font: 'mono', size: 6.8, width: CW - 60, gap: 1.8 }) + 4);
      const ry = doc.y;
      text('Replay', { x: CX, y: ry, width: 60, size: 8.5, color: C.ink3 });
      text(f.engineer.replay, { x: CX + 60, y: ry, width: CW - 60, size: 6.8, font: 'mono', color: C.ink2, gap: 1.8 });
    }

    label('Auditor');
    for (const c of f.auditor.controls) {
      // A control's source is printed only when it differs from its framework's source,
      // which the scorecard lists once per framework.
      const ownSource = c.source && c.source !== fwName(c.framework)?.source ? c.source : null;
      const h = measure(c.title, { size: 9, font: 'sansMed', width: CW - 86 }) + measure(c.plain, { size: 8.8, width: CW - 86 }) + (ownSource ? 10 : 0) + 8;
      ensure(h);
      const ry = doc.y;
      text(FW_SHORT[c.framework] || c.framework, { x: CX, y: ry + 0.5, width: 84, size: 7.5, color: C.ink3, lineBreak: false });
      text(c.id, { x: CX, y: ry + 10, width: 84, size: 8, font: 'monoMed', lineBreak: false });
      text(c.title, { x: CX + 86, y: ry, width: CW - 86, size: 9, font: 'sansMed', gap: 1.5 });
      text(c.plain, { x: CX + 86, width: CW - 86, size: 8.8, color: C.ink2, gap: 2 });
      if (ownSource) text(ownSource, { x: CX + 86, width: CW - 86, size: 6.4, font: 'mono', color: C.ink3, gap: 1, link: ownSource });
      doc.y = Math.max(doc.y, ry + 20) + 6;
    }
    if (f.auditor.source) {
      const h = measure(f.auditor.source, { size: 8.8, width: CW - 86 });
      ensure(h + 6);
      const ry = doc.y;
      text('Probe basis', { x: CX, y: ry + 0.5, width: 84, size: 7.5, color: C.ink3 });
      text(f.auditor.source, { x: CX + 86, y: ry, width: CW - 86, size: 8.8, color: C.ink2, gap: 2 });
      space(6);
    }
    {
      ensure(48);
      const e = f.auditor.evidence;
      const ry = doc.y;
      text('Evidence', { x: CX, y: ry + 0.5, width: 84, size: 7.5, color: C.ink3 });
      text(`Ledger seq ${e.ledgerSeq}, recorded ${stamp(e.ts)}`, { x: CX + 86, y: ry, width: CW - 86, size: 8.5, color: C.ink2 });
      const hy = doc.y + 2;
      [['payload', e.hash], ['entry', e.entryHash], ['transcript', e.transcriptHash]].forEach(([k, v], j) => {
        text(k, { x: CX + 86, y: hy + j * 9, width: 44, size: 6.6, color: C.ink3, lineBreak: false });
        text(v, { x: CX + 130, y: hy + j * 9, width: CW - 130, size: 6.2, font: 'mono', color: C.ink2, lineBreak: false });
      });
      doc.y = hy + 27;
    }

    if (f.decision) {
      label('Decision');
      ensure(30);
      const ry = doc.y;
      mark(f.decision.state === 'open' ? 'fail' : f.decision.state, CX, ry + 2.5, 8);
      text(`${DECISION_LABEL[f.decision.state] || f.decision.state} by ${f.decision.by} on ${longDate(f.decision.at)}.`, { x: CX + 14, y: ry, width: CW - 14, size: 9.5, font: 'sansMed' });
      if (f.decision.note) text(f.decision.note, { x: CX + 14, width: CW - 14, size: 9.5, color: C.ink2, gap: 3 });
      text('Recorded in the ledger as its own entry. It does not change the verdict or the grade.', { x: CX + 14, width: CW - 14, size: 8, color: C.ink3 });
    }
    doc.y = Math.max(doc.y, sideBottom) + 6;
  });

  // ══ 5. Adheres to ══════════════════════════════════════════════════════════
  const adheres = report.controls.filter((c) => c.status === 'adheres');
  const untestedControls = report.controls.filter((c) => c.status === 'untested');
  section('Adheres to', adheres.length
    ? `${Count(adheres.length)} of ${report.controls.length} mapped controls adhere: every probe mapped to them passed.`
    : `None of the ${report.controls.length} mapped controls adheres in full on this run, because each has at least one failing probe. The ${held.length} probes that held are listed below as evidence toward the controls they name.`);
  function controlRow(c) {
    const h = measure(c.title, { size: 9.5, font: 'sansMed', width: W - 120 }) + measure(c.plain, { size: 9, width: W - 120 }) + 12;
    ensure(h);
    const ry = doc.y;
    mark(controlMark[c.status], L, ry + 2.5, 8);
    text(FW_SHORT[c.framework] || c.framework, { x: L + 14, y: ry, width: 60, size: 8, color: C.ink3, lineBreak: false });
    text(c.id, { x: L + 14, y: ry + 11, width: 100, size: 8, font: 'monoMed', lineBreak: false });
    text(c.title, { x: L + 120, y: ry, width: W - 120, size: 9.5, font: 'sansMed', gap: 1.5 });
    text(c.plain, { x: L + 120, width: W - 120, size: 9, color: C.ink2, gap: 2.5 });
    doc.y = Math.max(doc.y, ry + 22) + 8;
  }
  if (adheres.length) {
    for (const fw of report.frameworks) {
      const list = adheres.filter((c) => c.framework === fw.id);
      if (!list.length) continue;
      subhead(fw.name, { size: 10.5 });
      list.forEach(controlRow);
      space(6);
    }
  }
  if (untestedControls.length) {
    subhead('Untested controls');
    text('No probe mapped to these failed, but at least one could not be decided, so they neither adhere nor show a gap.', { size: 9, color: C.ink2 });
    space(8);
    untestedControls.forEach(controlRow);
  }
  if (held.length) {
    subhead(`Probes that held (${held.length})`, { need: 80 });
    for (const f of held) {
      const desc = describe(f);
      const ids = f.auditor.controls.map((c) => c.id).join('  ');
      const h = measure(desc, { size: 8.8, width: W - 70 }) + measure(ids, { size: 6.8, font: 'mono', width: W - 70 }) + 22;
      ensure(h);
      const ry = doc.y;
      mark('pass', L, ry + 2.5, 8);
      text(f.probeId, { x: L + 14, y: ry, width: 56, size: 8.5, font: 'monoMed', lineBreak: false });
      text(SEV_LABEL[f.severity] || f.severity, { x: L + W - 70, y: ry, width: 70, size: 8, color: C.ink3, align: 'right', lineBreak: false });
      text(f.title, { x: L + 70, y: ry, width: W - 140, size: 9.5, font: 'sansMed', gap: 1.5 });
      doc.y = Math.max(doc.y, ry + 12);
      text(desc, { x: L + 70, width: W - 70, size: 8.8, color: C.ink2, gap: 2 });
      if (ids) text(ids, { x: L + 70, width: W - 70, size: 6.8, font: 'mono', color: C.ink3, gap: 1 });
      doc.y += 9;
    }
  }
  if (undecided.length) {
    subhead(`Not decided (${undecided.length})`, { need: 80 });
    for (const f of undecided) {
      ensure(34);
      const ry = doc.y;
      mark('inconclusive', L, ry + 2.5, 8);
      text(f.probeId, { x: L + 14, y: ry, width: 56, size: 8.5, font: 'monoMed', lineBreak: false });
      text(f.title, { x: L + 70, y: ry, width: W - 70, size: 9.5, font: 'sansMed' });
      text(`Why: ${f.engineer.reason}. What we check: ${describe(f)}`, { x: L + 70, width: W - 70, size: 8.8, color: C.ink2, gap: 2 });
      doc.y += 9;
    }
  }

  // ══ 6. Remediation plan ════════════════════════════════════════════════════
  section('Remediation plan', gaps.length
    ? 'Work from the top. Each fix names the probe that proves it, and the grade moves only when a re-run passes that probe.'
    : 'Nothing to fix on this run.');
  let step = 0;
  for (const s of ['critical', 'high', 'medium', 'low']) {
    const list = gaps.filter((f) => f.severity === s);
    if (!list.length) continue;
    subhead(`${SEV_LABEL[s]}, ${plural(list.length, 'fix', 'fixes')}`, { need: 90 });
    for (const f of list) {
      step += 1;
      const summary = f.engineer.remediation?.summary || 'No remediation is recorded for this probe. Read the rule and reason on the finding page.';
      const h = measure(summary, { size: 9.8, width: W - 34 }) + 40;
      ensure(h);
      const ry = doc.y;
      text(`${step}.`, { x: L, y: ry, width: 26, size: 10, font: 'sansBold', align: 'right', lineBreak: false });
      text(f.title, { x: L + 34, y: ry, width: W - 34, size: 10, font: 'sansBold', gap: 2 });
      text(summary, { x: L + 34, width: W - 34, size: 9.8, gap: 3.2 });
      const page = findingPage[f.probeId];
      const ctrl = f.auditor.controls.map((c) => c.id).join(', ');
      text(`Proven by ${f.probeId}.${f.engineer.remediation?.patch && page ? ` Patch on page ${page}.` : ''}${ctrl ? ` Affects ${ctrl}.` : ''}`,
        { x: L + 34, width: W - 34, size: 8.2, color: C.ink3, gap: 2 });
      if (f.decision) text(`${DECISION_LABEL[f.decision.state] || f.decision.state} by ${f.decision.by}${f.decision.note ? `: ${f.decision.note}` : '.'}`,
        { x: L + 34, width: W - 34, size: 8.2, color: C.ink2, gap: 2 });
      doc.y += 11;
    }
    space(4);
  }
  if (gaps.length) {
    subhead('When the fixes are in', { need: 160 });
    text('Run the full clearance again, or replay one probe against the live agent and compare it with the recorded verdict.', { size: 9.5, color: C.ink2, gap: 3 });
    space(8);
    codeBlock(
      `export LOXE_BASE_URL=${baseUrl}\nexport LOXE_API_KEY=lx_...            # an org API key\n\n` +
      `loxe run ${agentId}              # full clearance, prints the new grade\n` +
      `loxe replay ${runId} ${gaps[0].probeId}   # one probe, recorded vs now`,
      L, W, { size: 7.6 });
  }

  // ══ 7. How to verify this report yourself ══════════════════════════════════
  section('Check this report yourself', 'You do not have to trust Loxe or this PDF. Every verdict in it is a ledger entry you can recompute with standard tools, and the ledger head is signed.', { tocTitle: 'How to verify this report yourself' });
  const para = (str, o = {}) => { ensure(measure(str, { size: 10, gap: 3.8, ...o }) + 4); text(str, { size: 10, gap: 3.8, ...o }); space(10); };

  subhead('SHA-256 in one sentence');
  para('SHA-256 turns any input into a 64-character fingerprint: the same input always gives the same fingerprint, a one-character change gives an unrelated one, and in practice no one can work backwards from a fingerprint or find two inputs that share one.');
  {
    const a = '{"status":"pass"}';
    const b = '{"status":"fail"}';
    codeBlock(`sha256('${a}') = ${sha256(a)}\nsha256('${b}') = ${sha256(b)}`, L, W, { size: 6.6 });
    space(4);
    text('One word changed. The two fingerprints share nothing.', { size: 8.5, color: C.ink3 });
    space(16);
  }

  subhead('What the payload hash binds');
  para('After each probe, Loxe writes an evidence record and stores its canonical JSON: keys sorted, no whitespace. The payload hash is SHA-256 of that text. These are the fields it binds:');
  {
    const rows = [
      ['result', 'The verdict: status (pass, fail or not decided), the reason, and what matched.'],
      ['transcriptHash', 'SHA-256 of the full request and response transcript. Transcripts stay private to the agent owner, who can share them with an auditor to prove this hash.'],
      ['probeId, probeVersion', 'Which probe ran, and which version of its inputs and rule.'],
      ['libraryHash', `Fingerprint of the whole frozen probe library (${report.libraryName} v${report.libraryVersion}): ${short(report.libraryHash, 20)}`],
      ['agentId, runId, ts', 'Which agent, which run, and when.'],
      ['category, severity, title', 'How the probe is filed and weighted.'],
    ];
    for (const [k, v] of rows) {
      const h = measure(v, { size: 9, width: W - 150 });
      ensure(h + 8);
      const ry = doc.y;
      text(k, { x: L, y: ry, width: 144, size: 8, font: 'monoMed' });
      text(v, { x: L + 150, y: ry, width: W - 150, size: 9, color: C.ink2, gap: 2.5 });
      doc.y = Math.max(doc.y, ry + 10) + 5;
      rule(doc.y - 2, L, W, C.line, 0.4);
      space(3);
    }
    space(6);
    para('Change any one of these, even the timestamp, and the payload hash no longer matches. That is how a verdict is tied to the transcript that produced it and to the probe version that judged it.', { color: C.ink2, size: 9.5 });
  }

  // Chain diagram from the real first three entries of this run.
  subhead('How entries chain', { need: 240 });
  para('Each ledger entry hashes four things together: the agent, its sequence number, the entry hash of the entry before it, and its own payload hash. The first entry an agent ever records points at the genesis value, 64 zeros.');
  {
    codeBlock('entryHash = sha256(canonical({ agentId, seq, prevHash, payloadHash }))', L, W, { size: 8 });
    space(14);
    const bySeq = [...report.findings].sort((a, b) => a.auditor.evidence.ledgerSeq - b.auditor.evidence.ledgerSeq);
    const three = bySeq.slice(0, 3);
    const bw = 140;
    const gapX = (W - bw * 3) / 2;
    const bh = 128;
    ensure(bh + 40);
    const by = doc.y;
    three.forEach((f, i) => {
      const e = f.auditor.evidence;
      const bx = L + i * (bw + gapX);
      doc.save().roundedRect(bx, by, bw, bh, 4).lineWidth(0.8).strokeColor(C.lineStrong).stroke().restore();
      text(`seq ${e.ledgerSeq}`, { x: bx + 10, y: by + 9, width: bw - 20, size: 10, font: 'sansBold', lineBreak: false });
      text(f.probeId, { x: bx + 10, y: by + 10, width: bw - 20, size: 7.5, font: 'mono', color: C.ink3, align: 'right', lineBreak: false });
      const prev = i === 0 ? (e.ledgerSeq === 0 ? GENESIS : null) : three[i - 1].auditor.evidence.entryHash;
      const line = (lab, val, y, strong) => {
        text(lab, { x: bx + 10, y, width: bw - 20, size: 6.8, color: C.ink3, lineBreak: false });
        text(val, { x: bx + 10, y: y + 9, width: bw - 20, size: 7.2, font: strong ? 'monoMed' : 'mono', color: C.ink, lineBreak: false });
      };
      line('prevHash', prev ? short(prev, 18) : `entry hash of seq ${e.ledgerSeq - 1}`, by + 30);
      line('payloadHash', short(e.hash, 18), by + 54);
      rule(by + 80, bx + 10, bw - 20, C.line, 0.6);
      line('entryHash', short(e.entryHash, 18), by + 88, true);
      text(`= sha256 of the three above plus agentId`, { x: bx + 10, y: by + 110, width: bw - 20, size: 6.2, color: C.ink3, lineBreak: false });
      if (i < 2) {
        // Arrow from this entryHash to the next prevHash.
        const x1 = bx + bw;
        const y1 = by + 100;
        const x2 = bx + bw + gapX;
        const y2 = by + 42;
        const mx = (x1 + x2) / 2;
        doc.save().moveTo(x1, y1).bezierCurveTo(mx, y1, mx, y2, x2 - 4, y2).lineWidth(0.9).strokeColor(C.ink).stroke();
        doc.polygon([x2, y2], [x2 - 5, y2 - 3], [x2 - 5, y2 + 3]).fill(C.ink).restore();
      }
    });
    doc.y = by + bh + 8;
    text('Real values from this run. Each arrow is the entry hash of one entry becoming the prevHash of the next.', { size: 8, color: C.ink3 });
    space(16);
  }

  subhead('Why editing or deleting any entry breaks every later hash', { need: 120 });
  para('Edit one verdict and its payload hash changes. That changes its entry hash, so the next entry\'s prevHash no longer matches, and the mismatch runs all the way to the head. Delete an entry and the sequence numbers skip, and the next prevHash points at an entry that is not there. The verifier reports the first seq where this happens. The database also refuses UPDATE and DELETE on ledger rows, but the check above does not depend on that.');
  {
    // Tamper illustration: five small cells, the second edited, everything after it unproven.
    ensure(50);
    const y0 = doc.y;
    const n = 6;
    const cw = 58;
    const g = (W - n * cw) / (n - 1);
    for (let i = 0; i < n; i++) {
      const x = L + i * (cw + g);
      const kind = i < 1 ? 'ok' : i === 1 ? 'edited' : 'broken';
      if (kind === 'ok') doc.save().roundedRect(x, y0, cw, 22, 3).fill(C.proven).restore();
      else if (kind === 'edited') doc.save().polygon([x, y0], [x + cw - 10, y0], [x + cw, y0 + 10], [x + cw, y0 + 22], [x, y0 + 22]).fill(C.gap).restore();
      else doc.save().roundedRect(x + 0.5, y0 + 0.5, cw - 1, 21, 3).dash(2, { space: 2 }).lineWidth(0.9).strokeColor(C.gap).stroke().undash().restore();
      text(`seq ${i}`, { x: x + 6, y: y0 + 7, width: cw - 12, size: 7.5, font: 'mono', color: kind === 'broken' ? C.gapText : C.onInk, lineBreak: false });
      if (i < n - 1) doc.save().moveTo(x + cw + 1, y0 + 11).lineTo(x + cw + g - 1, y0 + 11).lineWidth(0.8).strokeColor(C.lineStrong).stroke().restore();
    }
    doc.y = y0 + 28;
    text('seq 1 was edited. Its hashes change, so seq 2 onward no longer recompute.', { size: 8, color: C.ink3 });
    space(16);
  }

  subhead('What the signature proves', { need: 170 });
  para('Someone who controlled the database could edit an entry and then recompute every hash after it, producing a chain that checks out on its own. The signature stops that. When this run finished, Loxe signed a short statement with its Ed25519 private key: the agent, the run, the head hash, the chain length, the library hash and the time. A rebuilt chain has a different head, and no one can make a valid signature over a new head without the private key.');
  if (report.signature) {
    const sig = report.signature;
    para(`The public key is published at ${baseUrl}/.well-known/loxe-signing-key. Its key ID is the first 16 hex characters of SHA-256 of the public key PEM: ${sig.keyId}. This is the signed statement in canonical form, followed by the signature:`, { color: C.ink2, size: 9.5 });
    codeBlock(`${canonicalize(sig.statement)}\n\nsignature (base64)\n${sig.signature}`, L, W, { size: 6.6 });
    space(6);
    text(`The head here is the chain as it stood when the report was issued (${report.ledger.length} entries). Later runs and recorded decisions add entries after it; they never change it.`, { size: 8.5, color: C.ink3, gap: 2.5 });
    space(16);
  }

  // Step by step.
  subhead('Step by step', { need: 200 });
  const firstHash = (gaps[0] || report.findings[0])?.auditor.evidence.hash || '<payload hash>';
  const steps = [
    ['Ask Loxe to recompute the whole chain.', `curl ${baseUrl}/verify/${agentId}`,
      `Expect "valid": true. "length" is at least ${report.ledger.length}, and grows as later entries are added.`],
    ['Look up any hash from this report.', `curl "${baseUrl}/verify?hash=${firstHash}"`,
      'Expect "found": true, the seq printed next to that hash in the appendix, and "chainValidAtEntry": true. The signed head works here too.'],
    ['Download the ledger and check it on your own machine.', `curl ${baseUrl}/ledger/${agentId}/export > ledger.json\ncurl -O ${baseUrl}/cli/loxe.mjs\nLOXE_BASE_URL=${baseUrl} node loxe.mjs verify ${agentId} --offline`,
      'The first command saves the full chain. The second uses the Loxe CLI: it downloads the same export and recomputes every payload hash and entry hash on your machine with the same rule as the server. Expect "Verified locally". The CLI is one file with no dependencies, downloaded from this Loxe instance; read it before you run it.'],
    ['Recompute one entry yourself, with no Loxe code at all.', null,
      'Save this as check.mjs and run node check.mjs ledger.json 0. Any seq works. It needs only Node 18 or later.'],
  ];
  steps.forEach(([title, cmd, expect], i) => {
    ensure(70);
    const ry = doc.y;
    text(`${i + 1}`, { x: L, y: ry, width: 16, size: 10, font: 'sansBold', lineBreak: false });
    text(title, { x: L + 22, y: ry, width: W - 22, size: 10, font: 'sansBold' });
    space(5);
    if (cmd) { codeBlock(cmd, L + 22, W - 22, { size: 7.2 }); space(5); }
    text(expect, { x: L + 22, width: W - 22, size: 9, color: C.ink2, gap: 2.8 });
    space(12);
  });
  codeBlock(
    "import { readFileSync } from 'node:fs';\n" +
    "import { createHash } from 'node:crypto';\n" +
    "const sha = (s) => createHash('sha256').update(s).digest('hex');\n" +
    'const [file, seq] = process.argv.slice(2);\n' +
    "const ledger = JSON.parse(readFileSync(file, 'utf8'));\n" +
    'const e = ledger.entries[Number(seq)];\n' +
    '// Canonical form: keys in sorted order, no whitespace.\n' +
    'const body = JSON.stringify({ agentId: ledger.agentId, payloadHash: e.payload_hash,\n' +
    '  prevHash: e.prev_hash, seq: e.seq });\n' +
    "console.log('payload hash matches:', sha(e.payload) === e.payload_hash);\n" +
    "console.log('entry hash matches:', sha(body) === e.entry_hash);",
    L + 22, W - 22, { size: 7 });
  space(8);
  text('Both lines should print true. To check the whole chain, also confirm that each entry\'s prev_hash equals the entry_hash before it, and that entry 0 has 64 zeros.', { x: L + 22, width: W - 22, size: 9, color: C.ink2, gap: 2.8 });
  space(14);
  if (report.signature) {
    ensure(150);
    const ry = doc.y;
    text('5', { x: L, y: ry, width: 16, size: 10, font: 'sansBold', lineBreak: false });
    text('Check the signature on the head.', { x: L + 22, y: ry, width: W - 22, size: 10, font: 'sansBold' });
    space(5);
    codeBlock(
      "import { verify } from 'node:crypto';\n" +
      `const { publicKey } = await (await fetch('${baseUrl}/.well-known/loxe-signing-key')).json();\n` +
      "const statement = '<the canonical statement printed above>';\n" +
      "const signature = '<the base64 signature printed above>';\n" +
      "console.log(verify(null, Buffer.from(statement), publicKey, Buffer.from(signature, 'base64')));",
      L + 22, W - 22, { size: 7 });
    space(5);
    text('Expect true. Change one character of the statement and it prints false.', { x: L + 22, width: W - 22, size: 9, color: C.ink2 });
  }

  // ══ 8. Evidence appendix ═══════════════════════════════════════════════════
  section('Evidence appendix', `Every probe in this run in ledger order, with the hashes that bind it. Paste any of them into ${baseUrl}/verify?hash=`);
  {
    const cols = { mark: L, seq: L + 14, id: L + 38, title: L + 80, hashLabel: L + 196, hash: L + 234 };
    doc.font(F.mono).fontSize(10);
    const hashSize = Math.min(6.4, (10 * (L + W - cols.hash)) / doc.widthOfString('0'.repeat(64)));
    const head = () => {
      const y0 = doc.y;
      for (const [k, s] of [['seq', 'Seq'], ['id', 'Probe'], ['title', 'Verdict'], ['hashLabel', 'Hashes']]) text(s, { x: cols[k], y: y0, width: 120, size: 7.5, font: 'sansMed', color: C.ink3, lineBreak: false });
      doc.y = y0 + 13;
      rule(doc.y, L, W, C.lineStrong);
      space(5);
    };
    head();
    const rows = [...report.findings].sort((a, b) => a.auditor.evidence.ledgerSeq - b.auditor.evidence.ledgerSeq);
    for (const f of rows) {
      if (doc.y + 40 > BOTTOM) { doc.addPage(); head(); }
      const e = f.auditor.evidence;
      const ry = doc.y;
      mark(f.status, cols.mark, ry + 1.5, 7);
      text(String(e.ledgerSeq), { x: cols.seq, y: ry, width: 22, size: 7.5, font: 'mono', lineBreak: false });
      text(f.probeId, { x: cols.id, y: ry, width: 44, size: 7.5, font: 'monoMed', lineBreak: false });
      text(statusWord[f.status], { x: cols.title, y: ry, width: 120, size: 7.5, font: 'sansMed', color: statusColor[f.status], lineBreak: false });
      text(f.title, { x: cols.title, y: ry + 10, width: 110, size: 7, color: C.ink3, gap: 1, height: 18, ellipsis: true });
      const hl = [['payload', e.hash], ['entry', e.entryHash], ['transcript', e.transcriptHash]];
      hl.forEach(([k, v], j) => {
        text(k, { x: cols.hashLabel, y: ry + j * 9.5, width: 44, size: 6.6, color: C.ink3, lineBreak: false });
        text(v, { x: cols.hash, y: ry + j * 9.5, width: L + W - cols.hash + 2, size: hashSize, font: 'mono', lineBreak: false });
      });
      doc.y = ry + 32;
      rule(doc.y - 3, L, W, C.line, 0.4);
      space(2);
    }
    space(16);
    if (report.signature) {
      subhead('Signature block', { need: 160 });
      const sig = report.signature;
      fact('Algorithm', sig.alg);
      fact('Key ID', sig.keyId, { mono: true, size: 8 });
      fact('Public key', `${baseUrl}/.well-known/loxe-signing-key`, { mono: true, size: 8 });
      fact('Head', sig.statement.head, { mono: true, size: 7 });
      fact('Length', String(sig.statement.length));
      fact('Library hash', sig.statement.libraryHash, { mono: true, size: 7 });
      fact('Signed at', stamp(sig.statement.ts));
      fact('Signature', sig.signature, { mono: true, size: 7 });
    }
    space(12);
    text('Decisions recorded after the run, such as a fix proposed, are later ledger entries of kind "decision". They appear in the export and in the chain check, and they never alter an evidence entry.', { size: 8.5, color: C.ink3, gap: 2.5 });
  }

  // ══ 9. Disclaimer ══════════════════════════════════════════════════════════
  section('What this report does not claim', report.disclaimer, { tocTitle: 'Disclaimer' });
  const notes = [
    ...(report.collectionNote ? [`Tested by hand. ${report.collectionNote}${report.coverage ? ` Coverage: ${coverageLine(report.coverage)}.` : ''}`] : []),
    `It says "cleared against ${report.total} probes on ${date}". It does not say certified, compliant, approved or audited. A SOC 2 report or an ISO certificate comes only from an independent auditor or certification body.`,
    'It covers behavior the probes can observe from outside the agent. It does not see the training data, the code, the hosting, or the people and processes around the agent.',
    'A control mapped here is evidence toward that control. It is not the control itself, and an auditor decides how much weight it carries.',
    'The result holds for the probe library, controls table and agent behavior on the date shown. A newer agent build or library version needs a new run. The live page always shows the latest one.',
  ];
  const fwIds = new Set(report.frameworks.map((f) => f.id));
  const sourceNotes = [
    fwIds.has('soc2') && 'SOC 2 criterion text is quoted from the AICPA TSP Section 100 (March 2020 edition). The 2022 revision changed points of focus, not criteria. C1.1 and A1.1 count only when the SOC 2 scope includes Confidentiality or Availability.',
    fwIds.has('owasp-llm') && 'OWASP LLM IDs and titles follow the 2025 list. 2023 numbering is not used.',
    fwIds.has('nist-ai-rmf') && 'NIST AI RMF quotes come from NIST AI 100-1. MAP 3.5 is partial evidence: a probe shows a confirmation step works, not that the oversight process is documented.',
    fwIds.has('iso42001') && 'ISO/IEC 42001 Annex A titles were cross-checked against secondary sources, not the paywalled standard. No ISO control text is quoted; the plain sentences are Loxe\'s own words.',
  ].filter(Boolean);
  const bullets = (list) => list.forEach((s) => {
    ensure(measure(s, { size: 9.8, width: W - 16 }) + 8);
    const ry = doc.y;
    doc.save().moveTo(L, ry + 7).lineTo(L + 7, ry + 7).lineWidth(0.9).strokeColor(C.ink3).stroke().restore();
    text(s, { x: L + 16, y: ry, width: W - 16, size: 9.8, gap: 3.4 });
    space(8);
  });
  bullets(notes);
  space(8);
  subhead('Notes on the controls table');
  bullets(sourceNotes);
  space(8);
  text(`Controls table v${report.controlsVersion}. Each framework's source is on the scorecard, and controls with their own page list it in the auditor sections. Set in Bodoni Moda, Geist and Geist Mono, used under the SIL Open Font License 1.1.`, { size: 8.5, color: C.ink3, gap: 2.5 });

  // ══ Contents (on the summary page) and running footers ═════════════════════
  const range = doc.bufferedPageRange();
  const total = range.count;
  if (tocFits) {
    doc.switchToPage(tocPage);
    doc.y = tocY;
    rule(tocY, L, W, C.lineStrong);
    text('In this report', { x: L, y: tocY + 10, width: LW, font: 'sansBold', size: 9.5 });
    const half = Math.ceil(toc.length / 2);
    const colW = (BW - 24) / 2;
    toc.forEach((t, i) => {
      const x = BX + (i < half ? 0 : colW + 24);
      const ty = tocY + 10 + (i % half) * 15;
      text(String(t.page), { x, y: ty, width: 22, size: 9, font: 'sansMed', lineBreak: false });
      text(t.title, { x: x + 24, y: ty, width: colW - 24, size: 9, color: C.ink2, lineBreak: false });
    });
  }
  for (let i = 0; i < total; i++) {
    doc.switchToPage(range.start + i);
    const saved = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    const fy = PAGE.h - 46;
    rule(fy, L, W, C.line, 0.6);
    owl(L, fy + 9, 11);
    text(`Loxe clearance, ${agentName}, ${runId}, page ${i + 1} of ${total}`, { x: L + 17, y: fy + 11, width: W - 17, size: 7.5, color: C.ink3, lineBreak: false });
    doc.page.margins.bottom = saved;
  }
  doc.end();
}
