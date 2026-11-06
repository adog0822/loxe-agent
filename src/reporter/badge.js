// SVG BADGE GENERATOR
// Produces a shields.io-style badge showing the agent's current grade. A hand test adds its
// coverage ("A · by hand 20/33") so a partial hand test never reads like a full run.

const GRADE_COLORS = {
  A: '22c55e',
  B: '84cc16',
  C: 'eab308',
  D: 'f97316',
  F: 'ef4444',
  'N/A': '6b7280',
};

export function generateBadge(grade, label = 'loxe', coverage = null) {
  const color = GRADE_COLORS[grade] || '6b7280';
  const value = coverage ? `${grade} · by hand ${coverage.answered}/${coverage.eligible}` : grade;
  const title = coverage
    ? `${label}: ${grade}, tested by hand, ${coverage.answered} of ${coverage.eligible} hand-testable probes answered, ${coverage.outOfScope} not run`
    : `${label}: ${grade}`;
  const labelWidth = label.length * 7 + 10;
  const gradeWidth = coverage ? Math.ceil(value.length * 6.6) + 12 : 40;
  const totalWidth = labelWidth + gradeWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${title}">
  <title>${title}</title>
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${labelWidth}" height="20" fill="#555"/>
    <rect x="${labelWidth}" width="${gradeWidth}" height="20" fill="#${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" text-rendering="geometricPrecision" font-size="11">
    <text x="${labelWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${labelWidth / 2}" y="14">${label}</text>
    <text x="${labelWidth + gradeWidth / 2}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${labelWidth + gradeWidth / 2}" y="14">${value}</text>
  </g>
</svg>`;
}
