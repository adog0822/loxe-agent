#!/usr/bin/env node
// DEPLOY LOXE TO MARITIME (idempotent)
// Usage: MARITIME_API_KEY=mk_... DATABASE_URL=... node scripts/deploy-maritime.js
//
// 1. Find the agent by name (agents.list({ name })). Create it if missing with
//    CreateAgentParams { name, template: 'custom', githubRepo, exposedPort: 3000, env: EnvVarInput[] }
//    (maritime-sdk dist/index.d.ts lines 605-644). Create kicks off the first deploy.
// 2. If it exists, upsert each env var (agents.setEnv, d.ts line 1935) and restart it
//    (agents.restart, d.ts line 1926). SDK 0.11.0 has no "redeploy from GitHub" method; whether a
//    restart rebuilds from the latest commit is not documented, so push + recreate if it does not.
// 3. Make the agent URL public (agents.setVisibility, d.ts line 1890) so /a/:id, /badge and the
//    Keiki tools can reach it. Needs a verified Maritime account; a failure is only a warning.
// 4. Subscribe ${url}/hooks/maritime to agent.deployed (webhooks.create, d.ts line 2874) once,
//    and store the one-time signing secret straight into the agent's MARITIME_WEBHOOK_SECRET.
// 5. Set LOXE_BASE_URL to the agent URL, reload env, print the URL.
// Secrets are never printed.
import { Maritime } from 'maritime-sdk';

const NAME = process.env.MARITIME_AGENT_NAME || 'loxe';
const REPO = process.env.LOXE_GITHUB_REPO || 'https://github.com/adog0822/loxe-agent';
const PORT = 3000;

if (!process.env.MARITIME_API_KEY) {
  console.error('MARITIME_API_KEY is required.');
  process.exit(1);
}

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY, timeout: 30_000 });

// [key, secret?] pairs. Only vars present in this shell are sent.
const ENV_KEYS = [
  ['DATABASE_URL', true],
  ['LOXE_SIGNING_KEY', true],
  ['LOXE_SESSION_SECRET', true],
  ['LOXE_SCHEDULE_SECRET', true],
  ['CLERK_SECRET_KEY', true],
  ['CLERK_PUBLISHABLE_KEY', false],
  ['SUPERMEMORY_API_KEY', true],
  ['KEIKI_API_KEY', true],
  ['KEIKI_AGENT_ID', false],
  ['KEIKI_NOTIFY_TARGETS', true],
  ['MARITIME_API_KEY', true],
  ['MARITIME_WEBHOOK_SECRET', true],
  ['LOXE_BASE_URL', false],
  ['LOXE_PROBE_LIBRARY', false],
  ['LOXE_PGLITE_DIR', false], // embedded Postgres on the agent's persistent volume when DATABASE_URL is unset
];

function envInputs() {
  const out = ENV_KEYS
    .filter(([key]) => process.env[key])
    .map(([key, secret]) => ({ key, value: process.env[key], secret }));
  out.push({ key: 'NODE_ENV', value: 'production', secret: false });
  return out;
}

const agentUrl = (a) => (a?.webUrl || a?.publicUrl || '').replace(/\/+$/, '') || null;

function fail(step, err) {
  console.error(`${step} failed: ${err?.status ?? ''} ${err?.detail || err?.message || err}`);
  process.exit(1);
}

async function findAgent() {
  const list = await maritime.agents.list({ name: NAME });
  return list.find((a) => a.name === NAME) || null;
}

async function main() {
  const env = envInputs();
  let agent = await findAgent().catch((e) => fail('List agents', e));

  if (!agent) {
    console.log(`Creating Maritime agent "${NAME}" from ${REPO} ...`);
    agent = await maritime.agents.create({
      name: NAME,
      template: 'custom',
      githubRepo: REPO,
      exposedPort: PORT,
      description: 'Loxe: deterministic AI agent clearance with hash-chained evidence',
      env,
    }).catch((e) => fail('Create', e));
  } else {
    console.log(`Agent "${NAME}" exists (${agent.id}). Updating ${env.length} env var(s) and restarting ...`);
    for (const { key, value, secret } of env) {
      await maritime.agents.setEnv(agent.id, key, value, { secret }).catch((e) => fail(`Set ${key}`, e));
    }
    agent = await maritime.agents.restart(agent.id).catch((e) => fail('Restart', e));
  }

  try {
    agent = await maritime.agents.setVisibility(agent.id, 'public');
  } catch (e) {
    console.warn(`Could not make the agent URL public (${e?.status ?? ''} ${e?.detail || e?.message}). Public pages stay private until you do.`);
  }

  agent = await maritime.agents.get(agent.id).catch(() => agent);
  const url = agentUrl(agent);
  if (!url) {
    console.log(`Agent ${agent.id} has no URL yet (status ${agent.status}). Re-run once it is deployed.`);
    return;
  }

  let envChanged = false;
  if (process.env.LOXE_BASE_URL !== url) {
    await maritime.agents.setEnv(agent.id, 'LOXE_BASE_URL', url, { secret: false }).catch((e) => fail('Set LOXE_BASE_URL', e));
    envChanged = true;
  }

  const hookUrl = `${url}/hooks/maritime`;
  const hooks = await maritime.webhooks.list().catch(() => []);
  if (!hooks.some((h) => h.url === hookUrl)) {
    const hook = await maritime.webhooks.create({ url: hookUrl, events: ['agent.deployed'] }).catch((e) => fail('Create webhook', e));
    await maritime.agents.setEnv(agent.id, 'MARITIME_WEBHOOK_SECRET', hook.secret, { secret: true })
      .catch((e) => fail('Store webhook secret', e));
    envChanged = true;
    console.log(`Webhook ${hook.id} -> ${hookUrl} (agent.deployed); secret stored in the agent env.`);
  }

  if (envChanged) await maritime.agents.reloadEnv(agent.id).catch((e) => console.warn(`Reload env: ${e?.message}`));

  console.log(`Agent:  ${agent.id} (${agent.status})`);
  console.log(`URL:    ${url}`);
  console.log(`Health: ${url}/health`);
}

main().catch((e) => fail('Deploy', e));
