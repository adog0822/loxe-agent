# Loxe

Deterministic agent clearance system. No LLM decides pass/fail — every evaluation is pure code against a frozen, versioned probe library, with results hash-chained into an append-only ledger.

## What it does

Loxe runs a battery of deterministic probes against any AI agent and produces:

- **A–F grade** based on worst open finding severity
- **Hash-chained evidence ledger** (append-only, Postgres-enforced immutability)
- **Framework mappings** to SOC 2, OWASP LLM Top 10, NIST AI RMF, and ISO/IEC 42001
- **Three renderings** per finding: plain-English, engineer, auditor (with evidence hashes)
- **PDF report** with grade badge, findings, and controls coverage
- **SVG badge** for embedding in docs/READMEs
- **Public clearance page** showing live clearance status
- **Sentinel** for scheduled re-runs and deploy-webhook triggers
- **Keiki integration** for approval-gated actions

## Architecture

```
Probe Library (frozen JSON) → Collector → Verifier (pure code)
  → Hash-chained Ledger (Supabase Postgres)
  → Controls Mapper (SOC2/OWASP/NIST/ISO)
  → Grading (A–F)
  → Reporter (PDF + Badge + HTML)
  → Sentinel (cron + webhooks)
  → Keiki (approval-gated actions)
```

## Quick start

```bash
npm install
cp .env.example .env.local   # fill in your keys
node src/server.js
```

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health check |
| POST | `/agents` | Register an agent |
| GET | `/agents` | List agents |
| POST | `/agents/:id/run` | Trigger clearance run |
| GET | `/runs/:id` | Run status + report |
| GET | `/clearance/:id` | Public clearance JSON |
| GET | `/clearance/:id/page` | Public clearance HTML |
| GET | `/badge/:id` | SVG badge |
| GET | `/report/:runId/pdf` | PDF download |
| GET | `/verify/:id` | Verify ledger chain |
| GET | `/ledger/:runId` | Ledger entries |
| POST | `/chat` | Maritime agent contract |

## Probe categories

- **Data exposure** — PII leaks, secret patterns, error stack traces
- **Tool permissions** — unauthorized tool calls, argument injection
- **Injection resistance** — prompt injection, jailbreak resistance
- **Harmful-action refusal** — dangerous action prevention
- **Operational hygiene** — HTTPS, versioning, rate limiting, latency

## Stack

Node 22, Hono, Supabase Postgres, PDFKit, Maritime hosting

## License

Proprietary
