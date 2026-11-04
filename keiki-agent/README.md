# Loxe on Keiki

One Keiki agent, `clearance`, with four tools that call the Loxe API:

| Tool | Approval | Loxe calls |
| --- | --- | --- |
| `submit_agent` | ask | `POST /api/agents`, `POST /api/agents/:id/runs` |
| `get_grade` | allow | `GET /api/agents/:id`, `GET /api/runs/:lastRunId` |
| `explain_finding` | allow | `GET /api/runs/:id` |
| `request_vendor_clearance` | ask | `POST /api/agents`, `POST /api/agents/:id/runs` |

`approval: 'ask'` is Keiki's `ToolPolicy`: a person approves before the tool runs (a Vault
Face ID card on iMessage, a button on Slack, or a reply in words elsewhere).

Commands people can text: `clear <url>`, `grade <agent-id>`, `explain <run-id> <probe-id>`,
`vendor <name> <url>`.

## Sync

Requires [Bun](https://bun.sh) (kit.sync bundles each tool with `Bun.build`).

```sh
cd keiki-agent
bun install
KEIKI_API_KEY=sk_live_... \
LOXE_BASE_URL=https://<your-loxe-host> \
LOXE_API_KEY=lx_... \
bun run sync
```

The output ends with `Sync complete: agent="clearance" id=<id>`. Put that id in Loxe's env as
`KEIKI_AGENT_ID` so grade-change notices work. Re-run `bun run sync` on every change.

`LOXE_API_KEY` is a Loxe org API key: the Keiki agent acts as that one org. `LOXE_BASE_URL`
and `LOXE_API_KEY` are synced as Keiki developer secrets, not baked into the bundle.

Optional env: `KEIKI_AGENT_NAME` (default `clearance`), `KEIKI_MODEL` (default
`anthropic/claude-sonnet-5`), `KEIKI_PLATFORM_URL` (default `https://onkeiki.com`).

## Channels

Channels attach in the Keiki dashboard (Agents > clearance > Channels). The agent config has
no channel code, so all of them get the same four tools:

- iMessage: buy a line, or use the shared number's join code.
- Slack: connect a Slack app (bot token + signing secret).
- Telegram: paste a BotFather bot token.
- Email: create an AgentMail inbox.
- API / CLI: Agents > clearance > API gateway > Turn on. Then any OpenAI client works:

```ts
import OpenAI from 'openai'
const keiki = new OpenAI({ baseURL: 'https://onkeiki.com/api/v1/openai', apiKey: process.env.KEIKI_API_KEY })
const r = await keiki.chat.completions.create({
  model: 'clearance',
  messages: [{ role: 'user', content: 'grade ag_123' }],
})
```

```sh
curl https://onkeiki.com/api/v1/openai/chat/completions \
  -H "Authorization: Bearer $KEIKI_API_KEY" -H 'Content-Type: application/json' \
  -d '{"model":"clearance","stream":false,"messages":[{"role":"user","content":"grade ag_123"}]}'
```

Sources: https://onkeiki.com/docs/cloud-agents.md, /docs/sdk.md, /docs/actions.md,
/docs/agent-api.md, /docs/partner-deployments.md, /openapi.json.
