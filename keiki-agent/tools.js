// LOXE TOOLS FOR KEIKI
// Each tool calls the Loxe HTTP API (docs/API.md) with `Authorization: Bearer ${LOXE_API_KEY}`.
// kit.sync() bundles every tool from THIS file into a standalone actor that runs on Keiki
// (@onkeiki/agents src/bundle.ts), so this module must have no side effects at import time.
// On Keiki, process.env is not ours: LOXE_API_KEY and LOXE_BASE_URL arrive as developer secrets
// (synced by index.js) and are read with ctx.secrets.get(). process.env is only a local fallback.
import { defineTool } from '@onkeiki/agents';
import { Effect, Schema } from 'effect';

const TIMEOUT_MS = 10_000;

async function loxeConfig(ctx) {
  const read = async (name) => {
    try {
      const v = ctx?.secrets ? await Effect.runPromise(ctx.secrets.get(name)) : null;
      if (v) return v;
    } catch { /* fall through to env */ }
    return (globalThis.process?.env?.[name]) || null;
  };
  const baseUrl = (await read('LOXE_BASE_URL'))?.replace(/\/+$/, '');
  const apiKey = await read('LOXE_API_KEY');
  if (!baseUrl || !apiKey) throw new Error('Loxe is not connected: LOXE_BASE_URL and LOXE_API_KEY secrets are missing.');
  return { baseUrl, apiKey };
}

async function loxe(ctx, method, path, body) {
  const { baseUrl, apiKey } = await loxeConfig(ctx);
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text.slice(0, 500) }; }
  if (!res.ok) throw new Error(`Loxe ${method} ${path} failed (${res.status}): ${data?.error || text.slice(0, 200)}`);
  return { baseUrl, data };
}

// POST /api/agents then POST /api/agents/:id/runs.
async function registerAndRun(ctx, { name, url, source }) {
  const { baseUrl, data: agent } = await loxe(ctx, 'POST', '/api/agents', { name, url, source });
  const { data: run } = await loxe(ctx, 'POST', `/api/agents/${encodeURIComponent(agent.id)}/runs`);
  return {
    agentId: agent.id,
    runId: run.runId,
    status: run.status,
    clearancePage: `${baseUrl}/a/${agent.id}`,
    next: `A run takes a minute or two. Ask for "grade ${agent.id}" to see the result.`,
  };
}

export const submitAgent = defineTool({
  name: 'submit_agent',
  description:
    'Register an AI agent endpoint with Loxe and start a clearance run against it. ' +
    'Use when the user says "clear <url>" or asks to test/grade their agent. Probes are sent to the URL, so this asks for approval first.',
  input: Schema.Struct({
    name: Schema.String,
    url: Schema.String,
  }),
  policy: { approval: 'ask' },
  execute: (input, ctx) => Effect.promise(() => registerAndRun(ctx, { name: input.name, url: input.url, source: 'keiki' })),
});

export const getGrade = defineTool({
  name: 'get_grade',
  description:
    'Get the current Loxe grade (A to F), latest run summary and evidence-chain status for an agent. Use for "grade <agent-id>".',
  input: Schema.Struct({ agentId: Schema.String }),
  policy: { approval: 'allow' },
  execute: (input, ctx) =>
    Effect.promise(async () => {
      const { baseUrl, data: agent } = await loxe(ctx, 'GET', `/api/agents/${encodeURIComponent(input.agentId)}`);
      let run = null;
      if (agent.lastRunId) {
        const { data } = await loxe(ctx, 'GET', `/api/runs/${encodeURIComponent(agent.lastRunId)}`);
        const r = data.report;
        run = {
          runId: data.id,
          status: data.status,
          progress: data.progress,
          summary: r?.gradeSummary ?? null,
          passed: r?.passed ?? null,
          failed: r?.failed ?? null,
          inconclusive: r?.inconclusive ?? null,
          failedFindings: (r?.findings || []).filter((f) => f.status === 'fail')
            .map((f) => ({ probeId: f.probeId, title: f.title, severity: f.severity })),
        };
      }
      return {
        agentId: agent.id,
        name: agent.name,
        grade: agent.grade,
        lastRunAt: agent.lastRunAt,
        chain: agent.chain,
        sentinel: agent.sentinel,
        run,
        clearancePage: `${baseUrl}/a/${agent.id}`,
        verify: `${baseUrl}/verify/${agent.id}`,
      };
    }),
});

export const explainFinding = defineTool({
  name: 'explain_finding',
  description:
    'Explain one finding from a Loxe run: what failed in plain English, how to fix it, and which SOC 2 / OWASP LLM / NIST AI RMF / ISO 42001 controls it maps to. Use for "explain <run-id> <probe-id>".',
  input: Schema.Struct({ runId: Schema.String, probeId: Schema.String }),
  policy: { approval: 'allow' },
  execute: (input, ctx) =>
    Effect.promise(async () => {
      const { baseUrl, data: run } = await loxe(ctx, 'GET', `/api/runs/${encodeURIComponent(input.runId)}`);
      const f = (run.report?.findings || []).find((x) => x.probeId === input.probeId);
      if (!f) {
        return {
          found: false,
          runStatus: run.status,
          probeIds: (run.report?.findings || []).map((x) => x.probeId),
        };
      }
      return {
        found: true,
        probeId: f.probeId,
        title: f.title,
        status: f.status,
        severity: f.severity,
        plainEnglish: f.plainEnglish,
        reason: f.engineer?.reason ?? null,
        fix: f.engineer?.remediation?.summary ?? null,
        controls: (f.auditor?.controls || []).map((c) => `${c.framework} ${c.id}: ${c.title}`),
        evidenceHash: f.auditor?.evidence?.hash ?? null,
        decision: f.decision,
        replay: `${baseUrl}/replay/${run.id}`,
      };
    }),
});

export const requestVendorClearance = defineTool({
  name: 'request_vendor_clearance',
  description:
    "Clear a third-party vendor's AI agent before the user's company adopts it. Registers the vendor's endpoint and starts a run; " +
    'returns a public clearance page to share with the vendor. Probes are sent to the vendor, so this asks for approval first.',
  input: Schema.Struct({
    vendorName: Schema.String,
    url: Schema.String,
    notes: Schema.optional(Schema.String),
  }),
  policy: { approval: 'ask' },
  execute: (input, ctx) =>
    Effect.promise(() => registerAndRun(ctx, { name: `Vendor: ${input.vendorName}`, url: input.url, source: 'keiki' })),
});

export const tools = [submitAgent, getGrade, explainFinding, requestVendorClearance];
