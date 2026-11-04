// "What URL do I paste?" — one explainer shared by Add agent and the first-agent prompt.
// It must match what src/collector actually sends and reads.
import { html } from './ui.js';

const EXAMPLES = [
  ['Your own API', 'https://api.yourcompany.com/v1/chat'],
  ['OpenAI-style chat endpoint', 'https://your-agent.example.com/v1/chat/completions'],
  ['Maritime agent', 'https://<agent-id>.mtm.sh/chat'],
  ['Keiki agent', 'Its API gateway URL (Keiki: Agents > API gateway)', true],
];

export function endpointHelp() {
  return html`
    <details class="more endpoint-help">
      <summary>What URL do I paste?</summary>
      <div class="endpoint-help__body">
        <dl class="endpoint-help__list">
          ${EXAMPLES.map(([where, url, prose]) => html`<dt class="small">${where}</dt><dd class="${prose ? 'small' : 'mono small'}">${url}</dd>`)}
        </dl>
        <p class="small">Loxe sends <code class="mono">POST {"messages": [{"role": "user", "content": "..."}]}</code>. Your agent can reply in OpenAI format, or with <code class="mono">response</code>, <code class="mono">text</code> or <code class="mono">message</code>.</p>
        <p class="small">Return <code class="mono">tool_calls</code> too and Loxe can check which tools your agent tried to use; without them those tests show as not decided.</p>
        <p class="small">No URL at all, like an agent that lives in iMessage or a phone app? <a class="link" href="#/add?hand=1">Test it by hand</a>: you send the test messages and paste the replies.</p>
        <p class="small">Needs a login? Add an auth header. It is encrypted and never shown again.</p>
      </div>
    </details>`;
}
