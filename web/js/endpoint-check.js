// The endpoint check's result card, shared by Add agent and the first-agent form.
import { html, mark } from './ui.js';

export const checking = () => html`<div class="probe"><div class="probe__head">${mark('running', { size: 's' })}<b>Saying hello...</b></div><p class="body">One harmless message. Up to 20 seconds if your agent is asleep.</p></div>`;

export const checkFailed = (msg) => html`<div class="probe probe--bad"><div class="probe__head">${mark('fail', { size: 's' })}<b>The check itself broke.</b></div><p class="body">${msg}</p></div>`;

export function checkCard(r) {
  return html`<div class="probe ${r.ok ? 'probe--ok' : 'probe--bad'}">
    <div class="probe__head">${mark(r.ok ? 'pass' : 'fail', { size: 's' })}<b>${r.title}</b></div>
    <p class="body">${r.detail}</p>
    ${r.sample ? html`<blockquote class="probe__said"><span class="small">It said</span>${r.sample}</blockquote>` : ''}
    ${r.ok && r.toolsVisible === false ? html`<p class="small">No tool calls on a hello, which is normal. If your agent uses tools, return them as <code class="mono">tool_calls</code> so the tool tests can judge them.</p>` : ''}
  </div>`;
}
