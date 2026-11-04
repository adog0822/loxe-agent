# Probe library

Loxe runs whatever battery is in `probes/library.json` (falls back to `library.example.json`).
Probes are data: fixed inputs plus a fixed pass/fail rule. The library is validated, frozen and
SHA-256 hashed at load; the hash is written to every run and every evidence object, so a report
always states exactly which battery an agent was cleared against. Bump `version` on any change.

The shipped `library.example.json` contains only operational-hygiene checks. Fill the other four
categories (data exposure, tool permissions, injection resistance, harmful-action refusal) from a
published red-team dataset or your own suite, mapped into this format.

## Format

```json
{
  "name": "loxe-core",
  "version": "2026.11.1",
  "probes": [
    {
      "id": "OH-01",                      // 2-4 capital letters, dash, 2-3 digits
      "version": 1,
      "category": "operational_hygiene",  // data_exposure | tool_permissions | injection_resistance | harmful_action_refusal | operational_hygiene
      "severity": "medium",               // severity of the finding if this probe FAILS
      "title": "Short name",
      "description": "Plain-English description of what the probe checks",
      "kind": "turns",                    // turns | raw | burst | inventory
      "turns": [{ "message": "..." }],     // kind=turns: one or more user turns, same conversation
      "raw": { "body": "{not json", "contentType": "application/json" },   // kind=raw
      "burst": { "count": 12, "message": "ping" },                          // kind=burst
      "rule": { "type": "no_error_leak" },
      "controls": ["SOC2-CC7.2"],         // optional: overrides the category default mapping
      "remediation": { "summary": "...", "patch": "unified diff or config snippet" }
    }
  ]
}
```

## Rule types (all deterministic, evaluated by `src/verifier`)

| type | params | passes when |
|---|---|---|
| `output_not_matches` | `patterns: [regex]`, `flags` | no turn's reply matches any pattern |
| `output_matches` | `patterns`, `turn` (index, default last) | that reply matches at least one pattern |
| `output_not_contains` | `strings: [..]` | no reply contains any string (canaries) |
| `no_secret_pattern` | | no reply contains API-key / private-key shapes |
| `no_pii_pattern` | `allow: [..]` | no reply contains email, SSN, card (Luhn), phone shapes, except allowed |
| `no_error_leak` | | no reply contains stack traces or internal paths |
| `no_tool_call` | `names: [regex]` | no recorded tool call matches (inconclusive if the target exposes no trace) |
| `tool_args_not_match` | `tool`, `patterns` | no matching tool call has args matching a pattern |
| `status_in` | `codes: [..]` | every HTTP status is in the list |
| `latency_under_ms` | `ms` | every turn answered under `ms` |
| `rate_limited` | | (burst) at least one 429 was returned |
| `inventory_has` | `fields: [..]` | the collector found every field (e.g. `version`, `tools`) |
| `https` | | the target URL is https |
| `all` / `any` | `rules: [..]` | combinators |
| `not` | `rule` | inverts pass/fail (inconclusive stays inconclusive) |
