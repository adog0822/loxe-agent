# Deploying Loxe

## 1. Postgres (Supabase)

Set `DATABASE_URL` to the Supabase connection string. Migrations run on boot (`migrations/*.sql`,
tracked in `schema_migrations`). A database that already has the 001 schema is adopted as-is.
Note: ledger rows written by the pre-fix code fail verification by design (their payload hashes never
matched). Archive those agents and re-clear them.

## 2. Auth (Clerk)

Create a Clerk application, then set `CLERK_SECRET_KEY` and `CLERK_PUBLISHABLE_KEY`. Turn on Google
sign-in in the Clerk dashboard if you want it. Clerk Organizations map to Loxe orgs; users without one
get a personal org. Dev sign-in is disabled whenever `NODE_ENV=production` or Clerk is configured.

## 3. Signing key

```bash
node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).replace(/\n/g,'\\\\n'))"
```

Set the output as `LOXE_SIGNING_KEY`. Keep it stable: it signs every ledger head.

## 4. Maritime

```bash
MARITIME_API_KEY=mk_... DATABASE_URL=... CLERK_SECRET_KEY=... CLERK_PUBLISHABLE_KEY=... \
SUPERMEMORY_API_KEY=... KEIKI_API_KEY=... LOXE_SIGNING_KEY=... NODE_ENV=production \
npm run deploy:maritime
```

The script creates (or updates) the `loxe` agent from `https://github.com/adog0822/loxe-agent` on port
3000, stores env as secrets, registers the `agent.deployed` webhook at `/hooks/maritime` (its secret goes
straight into `MARITIME_WEBHOOK_SECRET`), sets `LOXE_BASE_URL`, and prints the URL. On boot Loxe pushes
its hourly schedule; the schedule wakes `/chat` with `loxe:sentinel-tick`, which re-clears due agents.
Push the code to the GitHub repo first; the script restarts the agent but Maritime has no documented
"rebuild from latest commit" call.

## 5. Keiki

See `keiki-agent/README.md`: create an org API key in Loxe (`POST /api/keys`), then `bun run sync` with
`KEIKI_API_KEY`, `LOXE_BASE_URL`, `LOXE_API_KEY`. Attach iMessage, Slack, Telegram and email in the Keiki
dashboard. Put the printed agent id in Loxe's `KEIKI_AGENT_ID`.

## 6. Check

```bash
curl $LOXE_BASE_URL/health
LOXE_BASE_URL=... LOXE_API_KEY=lx_... node loxe.mjs clear https://your-agent.example.com
```
