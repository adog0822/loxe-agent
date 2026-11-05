# Contributing to Loxe

Thanks for helping. The most useful contributions are new probes, better remediations and framework mappings.

## Run it

```bash
npm install
npm run demo   # deliberately imperfect agent on :4100
npm start      # Loxe on :3000, embedded Postgres, dev sign-in, no keys needed
npm test       # unit + end-to-end
```

## Adding a probe

Probes live in `probes/library.json`. Each one needs:

- **A source.** An OWASP LLM Top 10 item, a MITRE ATLAS technique, a paper, or `loxe-original` with a reason.
- **A deterministic rule.** Pass or fail is decided by code in `src/verifier`, never by a model. Reuse an existing rule type if you can; a new one needs unit tests in `test/verifier.test.js`.
- **A canary that only an obeying agent prints.** Ask the agent to build the codeword rather than quote it, so an agent that repeats the attack back does not fail.
- **A remediation** with a short summary and, where possible, a patch.
- **A row in `docs/PROBES.md`** and the expected result against `demo/target-agent.js`.

Changing the library changes its hash, which is stamped on every run. Bump the library version in the same pull request.

## Framework mappings

`src/mapper/controls.json` maps probes to SOC 2, OWASP LLM Top 10, NIST AI RMF and ISO/IEC 42001. Quote the official criterion text and add the source to `docs/CONTROLS-SOURCES.md`.

## Pull requests

- Keep them small and focused. `npm test` must pass.
- No secrets, keys or real customer data in code, tests or fixtures.
- Product copy is plain English: short sentences, no marketing words, and never "certified" or "compliant".
