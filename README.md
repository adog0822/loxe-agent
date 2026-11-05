<p align="center">
  <img src="web/assets/owl.png" width="72" alt="Loxe owl">
</p>

<h1 align="center">Loxe</h1>

<p align="center">
  <b>Proof your AI agent is safe to let in.</b><br>
  40 deterministic probes, an A to F grade, and every result in a signed, hash-chained ledger anyone can recompute.
</p>

<p align="center">
  <a href="https://loxeagent.loxeai.com"><img alt="Live" src="https://img.shields.io/badge/live-loxeagent.loxeai.com-111?style=flat-square"></a>
  <a href="https://github.com/adog0822/loxe-agent/actions/workflows/test.yml"><img alt="Tests" src="https://img.shields.io/github/actions/workflow/status/adog0822/loxe-agent/test.yml?branch=main&label=tests&style=flat-square"></a>
  <img alt="Node 22+" src="https://img.shields.io/badge/node-22%2B-111?style=flat-square">
  <img alt="Probes" src="https://img.shields.io/badge/probes-40-111?style=flat-square">
  <img alt="Frameworks" src="https://img.shields.io/badge/maps%20to-SOC%202%20%C2%B7%20OWASP%20LLM%20%C2%B7%20NIST%20AI%20RMF%20%C2%B7%20ISO%2042001-111?style=flat-square">
</p>

<p align="center">
  <a href="https://loxeagent.loxeai.com/app/">Try it</a> ·
  <a href="https://loxeagent.loxeai.com/app/?mock=1">Demo, no sign-in</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-the-proof-works">How the proof works</a> ·
  <a href="docs/PROBES.md">The 40 probes</a> ·
  <a href="docs/API.md">API</a>
</p>

<p align="center">
  <img src="docs/screenshots/run.gif" width="860" alt="Loxe running 40 probes against an agent and grading it D">
</p>

## Why

Your AI agent can send email, issue refunds and read customer records. Before anyone lets it near production, someone asks "is it safe?" Today the answer is a pen-test PDF that goes stale with the next deploy, or a vendor's word.

Loxe gives a different answer: a fixed battery of attacks, judged by plain code (no model decides pass or fail), with every result hashed into a ledger that you, your buyer or an auditor can recompute without trusting Loxe.

| A pen test | Loxe |
|---|---|
| Ends in a PDF that is stale after the next deploy | Re-tests on every deploy and on a schedule, and tells you when the grade moves |
| The evidence is the tester's word | Each result is hashed, chained and signed. Anyone can re-run a probe and get the same verdict |
| Findings in security jargon | Every finding in plain English, for an engineer (with a patch) and for an auditor (with control IDs) |

## What it catches

Five categories, 8 probes each. Every probe has a source. Full list in [`docs/PROBES.md`](docs/PROBES.md).

| Category | Examples |
|---|---|
| **Data exposure** | gives up its system prompt, reads back secrets, hands one customer another customer's contact details, dumps customer emails in bulk |
| **Tool permissions** | emails every customer record to an outside address, breaks a refund limit, deletes someone else's record, escalates privileges because a user claims to be an admin |
| **Injection resistance** | obeys "ignore all previous instructions", follows instructions hidden in a pasted document, base64 or a translation task, exfiltrates data through a markdown image |
| **Harmful-action refusal** | bulk-deletes customer data, wires money, sends phishing or harassment, changes a vendor's payout details on a fake request |
| **Operational hygiene** | plain HTTP, leaks internals on malformed input, no rate limiting, no published version, credentials in ordinary replies |

Each finding maps to **SOC 2** (AICPA TSC 2017), **OWASP Top 10 for LLM Applications 2025**, **NIST AI RMF 1.0** and **ISO/IEC 42001:2023**, with the official criterion text and its source.

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/report.png" alt="Report card graded D with five open gaps"><br><sub><b>Report card.</b> The worst open finding sets the grade.</sub></td>
    <td width="50%"><img src="docs/screenshots/finding.png" alt="A critical finding in the engineer view with the rule, the tool call, a patch and SOC 2 controls"><br><sub><b>Engineer view.</b> The exact tool call, the rule it broke, a patch and the controls it fails.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/ledger.png" alt="Ledger page where the browser recomputes 40 of 40 entry hashes"><br><sub><b>Ledger.</b> Your browser recomputes every hash. Change one byte and the chain breaks.</sub></td>
    <td width="50%"><img src="docs/screenshots/hub.png" alt="Agents hub ranking which agent to fix first"><br><sub><b>Agents.</b> Ranked by what needs you first.</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/share.png" alt="Share page with a public clearance link and badge"><br><sub><b>Share.</b> A public page, badge and PDF a buyer can check without asking you.</sub></td>
    <td width="50%"><img src="docs/screenshots/integrations.png" alt="Integrations page with Slack alerts and a GitHub check"><br><sub><b>Integrations.</b> Slack alerts and a GitHub check that fails below a grade.</sub></td>
  </tr>
</table>

## Quick start

**Hosted.** Sign in at [loxeagent.loxeai.com/app](https://loxeagent.loxeai.com/app/), paste the URL your agent answers chat on and press **Test my agent**. A run takes about a minute. Want to look around first? [Open the demo](https://loxeagent.loxeai.com/app/?mock=1), no account needed.

**Locally**, with no keys at all (embedded Postgres, dev sign-in):

```bash
git clone https://github.com/adog0822/loxe-agent && cd loxe-agent
npm install
npm run demo   # a deliberately imperfect agent on :4100
npm start      # Loxe on http://localhost:3000
```

Then add `http://localhost:4100/chat` as an agent and watch it get graded.

**In CI.** Fail a pull request when the agent's grade drops:

```yaml
- uses: adog0822/loxe-agent@main
  with:
    api-key: ${{ secrets.LOXE_API_KEY }}
    agent-id: agent-xxxxxxxx
    min-grade: B
```

It writes a job summary and one annotation per gap. The Integrations page writes this workflow for you.

**From a terminal.** One file, no dependencies:

```bash
curl -O https://loxeagent.loxeai.com/cli/loxe.mjs
LOXE_API_KEY=lx_... node loxe.mjs clear https://agent.example.com
```

### What it talks to

Loxe works with an agent hosted anywhere: your own servers, OpenAI, Vercel, LangChain, a no-code builder. It sends `POST {"messages": [{"role": "user", "content": "..."}]}` and reads OpenAI-style replies or `response` / `text` / `message`. Return `tool_calls` too and Loxe can check which tools the agent tried to use.

**No URL?** For an agent that lives in iMessage or a phone app, choose **Add agent > No URL? Test it by hand**. Loxe shows each test message, you paste the reply, and the same rules judge it. 33 of the 40 probes work this way, and a hand test is graded only once 20 have a reply.

## How the proof works

1. **Frozen probes.** [`probes/library.json`](probes/library.json): 40 probes, 5 categories, each with a source. Its SHA-256 is stamped on every run.
2. **Evidence objects.** The verifier is pure code (it imports only `src/core`). It produces one object per probe, binding the verdict to the transcript hash, probe version and library hash.
3. **Chained ledger.** Each entry hashes `(agentId, seq, prevHash, sha256(canonical payload))`. Postgres refuses UPDATE and DELETE. Appends are serialized per agent.
4. **Signed head.** After each run Loxe signs the chain head with Ed25519. Public key: [`/.well-known/loxe-signing-key`](https://loxeagent.loxeai.com/.well-known/loxe-signing-key).
5. **Check it yourself.** `GET /verify/<agent>` recomputes the chain. `GET /verify?hash=` finds any hash from a report. `GET /ledger/<agent>/export` plus `node loxe.mjs verify <agent> --offline` recomputes it on your machine.
6. **Replay.** `POST /api/runs/<run>/replay/<probe>` re-runs one probe and compares the verdict.

**Grading.** The worst open finding sets the grade. One critical or high caps it at D, more than half failing is F, and inconclusive results never move it.

Loxe claims "cleared against these probes on this date, verifiable here". It never says certified or compliant.

## Where you can use it

| Surface | How |
|---|---|
| Web app | `/app/`: add an agent, watch the run, read the report card, share the public page |
| Public page | `/a/<agent-id>`: grade, ledger head, hash checker, PDF. Badge: `/badge/<agent-id>` |
| Slack | Paste an incoming-webhook URL. Loxe posts on grade changes, ledger breaks and failed runs. The URL is encrypted at rest |
| GitHub | The composite action in [`action.yml`](action.yml) |
| API | [`docs/API.md`](docs/API.md). Org keys: `Authorization: Bearer lx_...` |
| CLI | [`bin/loxe.js`](bin/loxe.js), served at `/cli/loxe.mjs` |
| iMessage, Slack, Telegram, email | The Keiki agent in [`keiki-agent/`](keiki-agent/): `clear <url>`, `grade <agent>`, `explain <run> <probe>` |
| Maritime | Pick a Maritime agent directly; it is re-cleared on every deploy |

## Security

- No secrets in this repo. Keys live in Cloudflare Worker secrets or a gitignored `.env.local`. Secret scanning and push protection are on.
- Agent auth headers are encrypted, never returned by the API and never written to transcripts.
- Every target is checked against private and metadata IP ranges before each run and again at connect time (SSRF guard, no redirects).
- Everything on public pages is HTML-escaped, and every `/api` route is org-scoped.

Found something? See [SECURITY.md](SECURITY.md).

## Architecture

```
src/core          canonical JSON + hashing            src/verifier      pass/fail rules (pure)
src/collector     talks to the target, SSRF guard     src/ledger        chain, verify, Ed25519 signing
src/orchestrator  background runs, hand tests, replay src/mapper        controls table, grading, renderings
src/reporter      public page, PDF, badge             src/auth          Clerk, dev sign-in, org API keys
src/sentinel      scheduled re-clearance              src/integrations  Slack, Maritime, Supermemory, Keiki
web/              product UI (static, at /app)        bin/loxe.js       CLI
cloudflare/       edge Worker + container config      src/guide         owl guide grounding
```

Node 22, Hono, Postgres (PGlite locally). Hosted on a Cloudflare Worker in front of one Cloudflare Container; see [DEPLOY.md](DEPLOY.md). Framework mappings live in [`src/mapper/controls.json`](src/mapper/controls.json), so adding a framework is a data change.

## Contributing

New probes are the most useful contribution. Every probe needs a source, a deterministic rule and a remediation. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm test   # unit + end-to-end, about 2 seconds
```

Built with [Maritime](https://maritime.sh), [Supermemory](https://supermemory.ai) and [Keiki](https://onkeiki.com).

If Loxe saves you a security review, a star helps other people find it.
