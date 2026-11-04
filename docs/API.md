# Loxe API contract

Single source of truth for the backend (src/), the product UI (web/) and the
integration modules (src/integrations/). All JSON. Times are ISO-8601 strings.

## Auth

- Browser: Clerk session (cookie `__session` or `Authorization: Bearer <clerk jwt>`).
  When `CLERK_SECRET_KEY` is unset and `NODE_ENV !== 'production'`, the server runs in
  **dev auth**: `POST /api/dev/login {email}` sets a signed `loxe_dev` cookie.
- Machines (Keiki tools, Maritime webhooks, CI): `Authorization: Bearer lx_<key>` org API key.
- Every `/api/*` route except `/api/config` and `/api/dev/login` requires auth and is scoped
  to the caller's org. Public routes (below) need no auth and expose no secrets.

`GET /api/config` → `{ auth: { provider: 'clerk' | 'dev', publishableKey?: string } }`
`GET /api/me` → `{ user: { id, email, name }, org: { id, name } }` or 401

## Agents

```
Agent = {
  id, name, url,
  source: 'url' | 'maritime' | 'keiki',
  maritimeAgentId?: string,
  grade: 'A'|'B'|'C'|'D'|'F'|null,
  lastRunId: string|null, lastRunAt: string|null,
  sentinel: { enabled: boolean, intervalHours: number, nextRunAt: string|null },
  chain: { valid: boolean, length: number, head: string|null },
  createdAt
}
```

- `GET  /api/agents` → `Agent[]`
- `POST /api/agents` `{ name, url, headers?, source?, maritimeAgentId? }` → `201 Agent`
  (url must be http(s); private/loopback hosts rejected unless `LOXE_ALLOW_PRIVATE_TARGETS=1`)
- `GET  /api/agents/:id` → `Agent` (headers never returned)
- `DELETE /api/agents/:id` → `204` (ledger rows stay; agent is archived)
- `POST /api/agents/:id/runs` → `202 { runId, status: 'queued' }`
- `GET  /api/agents/:id/runs` → `RunSummary[]`
- `POST /api/agents/:id/sentinel` `{ enabled, intervalHours? }` → `Agent.sentinel`

## Hand tests (agents with no URL)

- `POST /api/agents` `{ name, source: 'hand', where: 'iMessage' }` → agent with `url: null`, `where`
- `POST /api/agents/:id/runs` → `{ runId, status: 'awaiting_replies' }` (returns the open hand run if one exists)
- `GET /api/runs/:id/script` → `{ steps: [{ probeId, title, category, severity, messages: [..], saved }], skipped: [{ probeId, title }] }`
- `PUT /api/runs/:id/replies/:probeId` `{ replies: [..] }` or `{ skip: true }` → saved; one reply per message
- `POST /api/runs/:id/finish` → judges every saved reply with the same Verifier, appends evidence with `collection: 'hand'`, signs the head; the report carries `collection: 'hand'` and `collectionNote`

## Runs

```
Run = {
  id, agentId, status: 'queued'|'running'|'completed'|'failed',
  progress: { done: number, total: number, current: string|null },
  grade, startedAt, finishedAt, error: string|null,
  libraryVersion, libraryHash,
  report: ReportCard|null
}
ReportCard = {
  agentId, runId, grade, gradeSummary, ts, libraryVersion, libraryHash,
  total, passed, failed, inconclusive,
  categories: { [key]: { label, total, passed, failed, inconclusive } },
  frameworks: [{ id: 'soc2'|'owasp-llm'|'nist-ai-rmf'|'iso42001', name, version }],
  findings: Finding[],
  ledger: { head, length, valid }
}
Finding = {
  probeId, title, status: 'pass'|'fail'|'inconclusive', severity, category,
  plainEnglish: string,
  engineer: { reason, detail, remediation: { summary, patch? } | null, replay: string },
  auditor: {
    controls: [{ framework, id, title, plain }],
    evidence: { hash, ts, ledgerSeq, entryHash }
  },
  decision: { state: 'open'|'accepted_exception'|'fix_proposed'|'resolved', by, at, note } | null
}
```

- `GET  /api/runs/:id` → `Run` (poll every 1s while queued/running)
- `POST /api/runs/:id/replay/:probeId` → `{ probeId, original:{status,reason}, now:{status,reason}, same, transcript }`
- `GET  /api/keys` / `POST /api/keys {name}` → `{ id, name, key, prefix }` (key shown once) / `DELETE /api/keys/:id`
- `POST /api/dev/logout`

Report extras: `ReportCard.controls` = `[{ key, framework, id, title, plain, source, status: 'adheres'|'gap'|'untested', probes }]`,
`ReportCard.signature` = `{ alg: 'Ed25519', keyId, statement: { agentId, runId, head, length, libraryHash, ts }, signature }`,
`Finding.repeat` = true when Supermemory says this agent failed this probe before.
Public extras: `GET /.well-known/loxe-signing-key`, `GET /ledger/:agentId/export` (format `loxe-ledger/1`).
- `POST /api/runs/:id/findings/:probeId/decision` `{ state, note }` → `Finding.decision`
  (each decision is appended to the agent's ledger as its own entry)

## Integrations

- `GET /api/integrations` →
  `{ maritime: Status, keiki: Status, supermemory: Status, auth: { provider } }`
  where `Status = { configured: boolean, ok: boolean|null, partial: boolean, checkedAt }` (server config detail goes to the server log only)
- `GET /api/org/integrations` → `{ slack: { connected, mode, hint, lastStatus, lastAt }, github: { lastRun: { runId, agentId, agentName, status, grade, at } | null } }`
- `PUT /api/org/integrations/slack` `{ url, mode: 'changes'|'every' }` → sends a test message, stores the URL encrypted; 400 if it is not `https://hooks.slack.com/services/...` or Slack refuses
- `PATCH /api/org/integrations/slack` `{ mode }`, `POST /api/org/integrations/slack/test`, `DELETE /api/org/integrations/slack`
- `POST /api/agents/:id/runs` with header `x-loxe-trigger: ci:github` marks the run as a GitHub check (the CLI sets it inside GitHub Actions)
- `GET /api/maritime/agents` → `[{ id, name, status, url }]` (one-click intake)
- `GET /api/memory/:agentId` → `{ items: [{ title, summary, at }] }` (Supermemory history)

## Controls

- `GET /api/controls` → the controls table from `src/mapper/controls.json`

## Public (no auth)

- `GET /a/:agentId` → server-rendered clearance page (grade, ledger head, verify link)
- `GET /badge/:agentId` → SVG
- `GET /report/:runId/pdf` → PDF
- `GET /verify/:agentId` → `{ valid, length, head, error? }` (recomputes the whole chain)
- `GET /verify?hash=<sha256>` → `{ found, agentId, seq, entryHash, payloadHash, chainValidAtEntry }`
- `GET /api/runs/:id/transcripts` → raw probe transcripts (org-only; agent auth headers never stored)
- `GET /health` → `{ status: 'ok' }`, `POST /chat` → `{ response }` (Maritime contract)

## Machine hooks

- `POST /hooks/maritime` — Maritime webhook, HMAC-verified via `X-Maritime-Signature`
- `GET  /schedules` — Maritime schedule discovery for the sentinel cron
- `POST /sentinel/tick` — run due sentinel agents (org API key or Maritime schedule secret)
