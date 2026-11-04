# Loxe

The trust layer for AI agents. Point Loxe at an agent endpoint (or pick a Maritime agent) and it runs a
frozen battery of 40 deterministic probes against it, grades it A to F, writes every result to a
hash-chained ledger, maps each finding to SOC 2 / OWASP LLM Top 10 (2025) / NIST AI RMF / ISO/IEC 42001,
and gives you a public clearance page, a badge and a PDF. Every pass/fail verdict is pure code.

Loxe claims "cleared against these probes on this date, verifiable here". Never "certified" or "compliant".

Live: **https://loxeagent.loxeai.com** (app at `/app/`, what Loxe is at `/app/#/why`).

## Use it

1. Sign in at https://loxeagent.loxeai.com/app/ (Clerk; Google sign-in supported).
2. Paste your agent's URL and press **Test my agent**. The owl walks you through the result.
3. Share the public page `/a/<agent-id>`, the badge, or the PDF. Turn on monitoring to re-test on a schedule.

Toggle **Demo** in the nav for an owl-guided tour on sample data. Press **?** anywhere to ask the owl.

## Where people use it

| Surface | How |
|---|---|
| Web app | `/app/`: add an agent, watch the run, read the report card, share the public page |
| Public page | `/a/<agent-id>`: grade, ledger head, hash checker, PDF. Badge: `/badge/<agent-id>` |
| iMessage, Slack, Telegram, email | the Keiki agent in `keiki-agent/` (`clear <url>`, `grade <agent>`, `explain <run> <probe>`), channels attached in the Keiki dashboard |
| API | `docs/API.md`. Machine callers use an org key: `Authorization: Bearer lx_…` (create in the app or `POST /api/keys`) |
| CLI | `curl -O https://loxeagent.loxeai.com/cli/loxe.mjs`, then `LOXE_API_KEY=lx_… node loxe.mjs clear https://agent.example.com` (one file, no dependencies; source `bin/loxe.js`) |

## How the proof works

1. **Frozen probes.** `probes/library.json` (40 probes, 5 categories, each with a source). Its SHA-256 is on every run.
2. **Evidence objects.** The verifier (pure code, imports only `src/core`) produces one object per probe, binding
   the verdict to the transcript hash, probe version and library hash.
3. **Chained ledger.** Each entry hashes `(agentId, seq, prevHash, sha256(canonical payload))`. Postgres refuses
   UPDATE and DELETE. Appends are serialized per agent.
4. **Signed head.** After each run Loxe signs the chain head with Ed25519. Public key: `/.well-known/loxe-signing-key`.
5. **Check it yourself.** `GET /verify/<agent>` recomputes the chain, `GET /verify?hash=` finds any hash from a
   report, `GET /ledger/<agent>/export` + `node loxe.mjs verify <agent> --offline` recomputes it on your machine.
6. **Replay.** `POST /api/runs/<run>/replay/<probe>` re-runs one probe and compares the verdict.

Grading: driven by the worst open finding. One critical or high caps the grade at D; more than half failing is F;
inconclusive results never move the grade.

Framework mappings live in `src/mapper/controls.json` with official criterion text and sources
(`docs/CONTROLS-SOURCES.md`). Adding a framework is a data change.

## Sponsors

| | What Loxe uses it for | Code |
|---|---|---|
| Maritime | one-click intake of Maritime agents; hourly sentinel schedule; `agent.deployed` webhook re-clears on deploy (HMAC `X-Maritime-Signature`) | `src/integrations/maritime.js`, `scripts/deploy-maritime.js` |
| Supermemory | one namespace per org: run history, failed findings, decisions. Flags repeat failures. Context only; the ledger stays in Postgres | `src/integrations/supermemory.js` |
| Keiki | the messaging front door (iMessage, Slack, Telegram, email, WhatsApp) with approval on `submit_agent`; grade-change notices | `keiki-agent/`, `src/integrations/keiki.js` |

## Hosting

Cloudflare: a Worker (`cloudflare/`) owns `loxeagent.loxeai.com`, runs the owl guide on Workers AI and an hourly
sentinel cron, and proxies everything else to one Cloudflare Container running this Node server. See `DEPLOY.md`.

## Security

- No secrets live in this repo. Keys are Cloudflare Worker secrets (`wrangler secret put`) or a local, gitignored
  `.env.local`. `.env.example` lists the names only. GitHub secret scanning and push protection are on.
- Agent auth headers are stored server-side and never returned by the API or written to transcripts.
- Targets are checked against private and metadata IP ranges before every run (SSRF guard).
- Everything rendered on public pages is HTML-escaped. Every `/api` route is org-scoped.
- The ledger is append-only in Postgres and every head is signed with Ed25519.

## Develop locally

```bash
npm install
npm run demo          # deliberately imperfect demo agent on :4100
npm start             # Loxe on :3000 with embedded Postgres and dev sign-in (no keys needed)
npm test              # unit + end-to-end
```

## Layout

```
src/core        canonical JSON + hashing          src/verifier   pass/fail rules (pure)
src/collector   talks to the target, SSRF guard   src/ledger     chain, verify, Ed25519 signing
src/orchestrator background runs + replay         src/mapper     controls table, grading, 3 renderings
src/reporter    public page, PDF, badge           src/auth       Clerk, dev sign-in, org API keys
src/sentinel    scheduled re-clearance            src/integrations  Maritime, Supermemory, Keiki
web/            product UI (static, served at /app)   bin/loxe.js  CLI     keiki-agent/  Keiki agent
cloudflare/     edge Worker + container config        src/guide    owl guide grounding
```
