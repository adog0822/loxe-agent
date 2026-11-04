# Deploying Loxe (Cloudflare)

Loxe runs as one Cloudflare Container (this repo's `Dockerfile`) behind a Worker in `cloudflare/`.
The Worker serves `loxeagent.loxeai.com`, answers the owl guide with Workers AI, and fires the hourly sentinel.

## Prerequisites

- Cloudflare account on the Workers Paid plan, with the `loxeai.com` zone. `wrangler login`.
- Docker running locally (Colima works: `brew install colima docker docker-buildx && colima start`).

## Secrets

Set each once (values never go in the repo):

```bash
cd cloudflare
wrangler secret put DATABASE_URL          # Supabase session-pooler URI; without it data resets on restart
wrangler secret put CLERK_SECRET_KEY
wrangler secret put CLERK_PUBLISHABLE_KEY
wrangler secret put LOXE_SIGNING_KEY      # Ed25519 PKCS#8 PEM, \n-escaped; keep it stable
wrangler secret put LOXE_SCHEDULE_SECRET  # random; authorizes the cron's /sentinel/tick
wrangler secret put SUPERMEMORY_API_KEY
wrangler secret put KEIKI_API_KEY
wrangler secret put MARITIME_API_KEY
```

Generate a signing key:

```bash
node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).trim().replace(/\n/g,'\\\\n'))"
```

## Deploy

```bash
cd cloudflare && npm install && npx wrangler deploy
curl https://loxeagent.loxeai.com/health
```

Migrations run on container boot. Rows written to the ledger by pre-fix versions fail verification by design; re-clear those agents.

## Keiki

See `keiki-agent/README.md`: create an org API key in the app (Connect page), then `bun run sync` with
`KEIKI_API_KEY`, `LOXE_BASE_URL=https://loxeagent.loxeai.com` and that key. Attach iMessage, Slack, Telegram and
email in the Keiki dashboard and turn on the API gateway. Put the printed agent id in the `KEIKI_AGENT_ID` secret.

## Maritime

Maritime is an integration, not the host: users pick Maritime agents to clear, and a Maritime `agent.deployed`
webhook (`/hooks/maritime`, HMAC via `MARITIME_WEBHOOK_SECRET`) re-clears them on deploy.
