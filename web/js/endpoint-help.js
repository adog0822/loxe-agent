// "What URL do I paste?" — one explainer shared by Add agent and the first-agent prompt.
// It must match what src/collector actually sends and reads (src/collector/reply.js).
import { html } from './ui.js';

const WORKS = [
  ['Next.js or Vercel app', 'https://your-app.vercel.app/api/chat'],
  ['OpenAI-style API', 'https://api.yourcompany.com/v1/chat/completions'],
  ['AWS', 'Your API Gateway or Lambda function URL', true],
  ['Keiki agent', 'Its API gateway URL (Keiki: Agents > API gateway)', true],
];

export function endpointHelp() {
  return html`
    <details class="more endpoint-help">
      <summary>Which URL is the right one?</summary>
      <div class="endpoint-help__body">
        <p class="small">The one your chat box sends messages to. Open your browser's dev tools, send your agent a message, and look in the Network tab for the request that fired. That URL.</p>
        <dl class="endpoint-help__list">
          ${WORKS.map(([where, url, prose]) => html`<dt class="small">${where}</dt><dd class="${prose ? 'small' : 'mono small'}">${url}</dd>`)}
        </dl>
        <p class="small">Won't work: a GitHub repo, your homepage, a hosting dashboard, or a database like Athena. None of those can chat back.</p>
        <p class="small">Loxe sends <code class="mono">POST {"messages": [{"role": "user", "content": "..."}]}</code>, or the Vercel AI SDK shape if that's what your route wants. It reads OpenAI, Anthropic and Vercel AI SDK replies, streamed or all at once, plus plain <code class="mono">response</code>, <code class="mono">text</code> or <code class="mono">message</code>.</p>
        <p class="small">Return <code class="mono">tool_calls</code> and Loxe can check which tools your agent tried to use. Without them, those tests come back undecided.</p>
        <p class="small">No URL at all? <a class="link" href="#/add?hand=1">Test it by hand</a>.</p>
      </div>
    </details>`;
}
