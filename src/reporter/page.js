// PUBLIC CLEARANCE PAGE (/a/:agentId) — server-rendered so a buyer clicking a badge gets it fast.
// Every value from the database or the target agent is escaped: agent names and transcripts are
// attacker-controlled input.
const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

const STATE = { pass: 'Held', fail: 'Gap', inconclusive: 'Untested' };

export function clearancePage({ agent, report, chain, baseUrl, notFound }) {
  if (notFound) return shell('Not found', `<main><h1>No public clearance here</h1><p>This agent does not exist or its owner has not made it public.</p></main>`);

  const head = chain.head || '';
  const gaps = report ? report.findings.filter((f) => f.status === 'fail') : [];
  const held = report ? report.findings.filter((f) => f.status === 'pass') : [];
  const date = report ? new Date(report.ts).toISOString().slice(0, 10) : null;
  const fw = report ? report.frameworks.map((f) => esc(f.name)).join(', ') : '';

  const row = (f) => `<li class="f ${esc(f.status)}">
    <span class="mark" aria-hidden="true"></span>
    <span class="t">${esc(f.title)}</span>
    <span class="s">${esc(STATE[f.status])}${f.status === 'fail' ? `, ${esc(f.severity)}` : ''}</span>
    <details><summary>Evidence</summary>
      <p>${esc(f.plainEnglish)}</p>
      <p class="mono">${f.auditor.controls.map((c) => esc(`${c.framework.toUpperCase()} ${c.id}`)).join('  ')}</p>
      <p class="mono">sha256 ${esc(f.auditor.evidence.hash)}</p>
    </details></li>`;

  const body = `<main>
  <header>
    <p class="who">${esc(agent.name)}</p>
    <div class="grade g-${esc(agent.current_grade || 'none')}">${esc(agent.current_grade || '–')}</div>
    <h1>${report ? `Cleared against ${report.total} probes on ${esc(date)}` : 'Not cleared yet'}</h1>
    ${report ? `<p class="lede">${esc(report.gradeSummary)}. Frameworks mapped: ${fw}.</p>` : ''}
  </header>
  ${report ? `
  <section class="proof ${chain.valid ? 'ok' : 'bad'}">
    <h2>${chain.valid ? 'The evidence ledger verifies' : 'The evidence ledger does not verify'}</h2>
    <p>${chain.length} entries, each hashed and chained to the one before. Recompute it yourself:</p>
    <p class="mono">head ${esc(head)}</p>
    <p><a href="/verify/${esc(agent.id)}">Recompute the chain</a> <a href="/ledger/${esc(agent.id)}/export">Download the ledger</a> <a href="/report/${esc(report.runId)}/pdf">PDF report</a></p>
    ${report.signature ? `<p class="mono small">Signed ${esc(report.signature.alg)} key ${esc(report.signature.keyId)}, public key at <a href="/.well-known/loxe-signing-key">/.well-known/loxe-signing-key</a></p>` : ''}
  </section>
  <section class="split">
    <div><h2>Gaps (${gaps.length})</h2><ul>${gaps.map(row).join('') || '<li class="empty">None open.</li>'}</ul></div>
    <div><h2>Held (${held.length})</h2><ul>${held.map(row).join('')}</ul></div>
  </section>` : ''}
  <form class="check" action="/verify" method="get">
    <label for="h">Have a hash from a report? Check it against the ledger.</label>
    <input id="h" name="hash" placeholder="64-character sha256" pattern="[0-9a-fA-F]{64}" required>
    <button>Check hash</button>
  </form>
  ${report?.collectionNote ? `<p class="disc"><b>Tested by hand.</b> ${esc(report.collectionNote)}</p>` : ''}
  <p class="disc">${esc(report?.disclaimer || 'Clearance is evidence of tested behavior at a point in time, not a certification.')}</p>
</main>`;
  return shell(`${agent.name} clearance`, body);
}

function shell(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | Loxe</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:opsz,wght@6..96,500;6..96,700&family=Geist:wght@400;500;600&family=Geist+Mono&display=swap" rel="stylesheet">
<style>
:root{--bg:#f6f8f7;--ink:#0d1412;--mute:#5b6763;--line:#d9e0dd;--proven:#0f9d6b;--gap:#e5452b;--stale:#b98a12}
@media (prefers-color-scheme:dark){:root{--bg:#0b100f;--ink:#eef3f1;--mute:#93a19c;--line:#24302c;--proven:#2fd39b;--gap:#ff6b3d;--stale:#e0b43a}}
*{box-sizing:border-box;margin:0}body{background:var(--bg);color:var(--ink);font:15px/1.5 Geist,system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:48px 16px 64px}header{display:grid;grid-template-columns:auto 1fr;gap:4px 24px;align-items:end;margin-bottom:40px}
.who{grid-column:1/-1;color:var(--mute)}.grade{grid-row:2/4;font:700 112px/0.9 'Bodoni Moda',serif}
.g-A,.g-B{color:var(--proven)}.g-D,.g-F{color:var(--gap)}.g-C{color:var(--stale)}
h1{font:500 32px/1.15 'Bodoni Moda',serif}.lede{color:var(--mute);max-width:60ch}h2{font-size:15px;font-weight:600;margin-bottom:8px}
.proof{border:1px solid var(--proven);border-radius:6px;padding:20px;margin-bottom:32px}
.proof h2{color:var(--proven)}.proof.bad{border-color:var(--gap)}.proof.bad h2{color:var(--gap)}.proof a{margin-right:16px;color:var(--ink)}
.mono{font:13px/1.5 'Geist Mono',monospace;word-break:break-all;color:var(--mute)}.small{font-size:12px;margin-top:8px}
.split{display:grid;grid-template-columns:3fr 2fr;gap:32px}@media(max-width:700px){.split{grid-template-columns:1fr}header{grid-template-columns:1fr}.grade{grid-row:auto}}
ul{list-style:none;padding:0}.f{display:grid;grid-template-columns:14px 1fr auto;gap:10px;padding:10px 0;border-bottom:1px solid var(--line);align-items:center}
.mark{width:12px;height:12px;border:2px solid var(--mute)}.pass .mark{background:var(--proven);border-color:var(--proven)}
.fail .mark{border-color:var(--gap);background:repeating-linear-gradient(45deg,var(--gap) 0 2px,transparent 2px 4px)}
.inconclusive .mark{border-style:dashed}.s{color:var(--mute);font-size:13px}.fail .s{color:var(--gap)}
details{grid-column:2/-1}summary{cursor:pointer;color:var(--mute);font-size:13px}details p{margin:6px 0}
.check{margin-top:40px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.check label{width:100%;color:var(--mute)}
input{flex:1;min-width:240px;padding:10px;border:1px solid var(--line);border-radius:4px;background:transparent;color:var(--ink);font:13px 'Geist Mono',monospace}
button{padding:10px 16px;border:0;border-radius:4px;background:var(--ink);color:var(--bg);font:600 14px Geist,sans-serif;cursor:pointer}
.disc{margin-top:40px;color:var(--mute);font-size:13px;max-width:70ch}.empty{color:var(--mute);padding:10px 0}
</style></head><body>${body}</body></html>`;
}
