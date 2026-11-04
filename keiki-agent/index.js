// LOXE KEIKI AGENT — definition + sync (infra-as-code).
// `bun run sync` pushes this config, the four tools in tools.js and the Loxe secrets to Keiki
// (POST https://onkeiki.com/api/v1/developer/sync, done by kit.sync()). Keiki then runs the
// agent on every channel connected to it: iMessage, Slack, Telegram, email (AgentMail),
// WhatsApp and the OpenAI-compatible API gateway. Channels are attached in the Keiki dashboard;
// the agent config itself stays channel-free, so the same tools work everywhere.
//
// Must run under Bun: kit.sync() bundles each tool with Bun.build.
import { AgentKit } from '@onkeiki/agents';
import { tools } from './tools.js';

const required = ['KEIKI_API_KEY', 'LOXE_BASE_URL', 'LOXE_API_KEY'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env: ${missing.join(', ')}`);
  process.exit(1);
}

const kit = AgentKit.create({
  apiKey: process.env.KEIKI_API_KEY,
  name: process.env.KEIKI_AGENT_NAME || 'clearance',
  // Developer secrets, readable inside tools via ctx.secrets.get(). Values are never logged.
  secrets: {
    LOXE_BASE_URL: process.env.LOXE_BASE_URL,
    LOXE_API_KEY: process.env.LOXE_API_KEY,
  },
  agent: {
    model: process.env.KEIKI_MODEL || 'anthropic/claude-sonnet-5',
    maxSteps: 8,
    historyLimit: 30,
    reasoningEffort: 'low',
    guards: true,
    promptGuard: true,
    systemPrompt: () => [
      'You are Loxe Clearance. Loxe clears AI agents by running a frozen battery of deterministic probes',
      'against them and recording hash-chained evidence. You are the front door to Loxe on text channels.',
      '',
      'Commands people send, and the tool for each:',
      '- "clear <url>" or "clear <name> <url>": submit_agent. Use the hostname as the name if none is given.',
      '- "grade <agent-id>": get_grade.',
      '- "explain <run-id> <probe-id>": explain_finding.',
      '- "vendor <vendor name> <url>": request_vendor_clearance, for a third party\'s agent.',
      'Plain-language requests that mean the same thing map to the same tools.',
      '',
      'Rules:',
      '- Grades and findings come only from tool results. Never guess a grade or invent a finding.',
      '- Keep replies short: they are read in iMessage, Slack, Telegram and email.',
      '- Always include the clearance page link a tool returns.',
      '- A run takes a minute or two; after submitting, tell the person to ask for the grade shortly.',
      '- If a tool says Loxe is not connected, say so plainly and stop.',
    ].join('\n'),
    tools,
  },
});

await kit.sync();
console.log('Synced. Next: connect channels and turn on the API gateway in the Keiki dashboard (see README).');
