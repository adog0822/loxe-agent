// LOXE EDGE WORKER
// - Proxies every request to the single Loxe container (agents, runs, ledger, UI, public pages).
// - POST /api/owl: asks the container for the caller's grounded prompt (auth + org checked there),
//   then answers with Workers AI. No model key leaves Cloudflare.
// - Hourly cron: POST /sentinel/tick on the container with the schedule secret.
import { Container, getContainer } from '@cloudflare/containers';

const PASS_THROUGH = [
  'DATABASE_URL', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY', 'LOXE_SIGNING_KEY', 'LOXE_SCHEDULE_SECRET',
  'LOXE_SESSION_SECRET', 'SUPERMEMORY_API_KEY', 'KEIKI_API_KEY', 'KEIKI_AGENT_ID', 'KEIKI_NOTIFY_TARGETS',
  'MARITIME_API_KEY', 'MARITIME_WEBHOOK_SECRET', 'LOXE_BASE_URL', 'LOXE_DATA_KEY',
];

export class LoxeContainer extends Container {
  defaultPort = 3000;
  sleepAfter = '2h';
  constructor(ctx, env) {
    super(ctx, env);
    this.envVars = {
      NODE_ENV: 'production',
      PORT: '3000',
      LOXE_INTERNAL_SCHEDULER: '0',
      ...Object.fromEntries(PASS_THROUGH.filter((k) => env[k]).map((k) => [k, String(env[k])])),
    };
  }
}

const loxe = (env) => getContainer(env.LOXE, 'main');

async function owl(request, env) {
  const ctxReq = new Request(new URL('/api/owl/context', request.url), {
    method: 'POST',
    headers: request.headers,
    body: await request.text(),
  });
  const ctxRes = await loxe(env).fetch(ctxReq);
  if (!ctxRes.ok) return ctxRes;
  const { model, messages } = await ctxRes.json();
  try {
    const out = await env.AI.run(model, { messages, max_tokens: 500 });
    return Response.json({ answer: out.response || '' });
  } catch (err) {
    return Response.json({ error: `guide unavailable: ${err.message}` }, { status: 503 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'POST' && url.pathname === '/api/owl') return owl(request, env);
    return loxe(env).fetch(request);
  },
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      loxe(env).fetch(new Request('https://loxeagent.loxeai.com/sentinel/tick', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.LOXE_SCHEDULE_SECRET}` },
      }))
    );
  },
};
