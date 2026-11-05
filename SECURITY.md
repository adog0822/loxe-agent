# Security policy

Loxe sends requests to URLs that users give it and keeps a tamper-evident ledger, so we take reports seriously.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting: **Security > Report a vulnerability** on this repository. Include the steps to reproduce and what an attacker could reach.

We aim to reply within 3 business days.

## In scope

- Reaching internal networks through the collector (SSRF), including DNS rebinding and redirect tricks
- Reading or changing another organization's agents, runs, keys or integrations
- Editing or deleting a ledger entry without `/verify` noticing
- Leaking agent auth headers, Slack webhook URLs or API keys through the API, transcripts, public pages or the PDF
- XSS on public pages (`/a/<agent-id>`, the badge, the verify pages)

## Out of scope

- Findings that need a compromised account or a malicious browser extension
- Rate limits on the hosted demo
- Reports produced only by automated scanners, with no working proof
