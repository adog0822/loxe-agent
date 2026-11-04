// LOXE SERVER ENTRY POINT
import { serve } from '@hono/node-server';
import { createDb } from './db/index.js';
import { createApp } from './app/index.js';

for (const f of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(f);
  } catch {}
}

const port = parseInt(process.env.PORT || '3000', 10);
// On Maritime the public URL is https://<agent-id>.mtm.sh (MARITIME_AGENT_ID is injected).
const baseUrl = (
  process.env.LOXE_BASE_URL ||
  (process.env.MARITIME_AGENT_ID ? `https://${process.env.MARITIME_AGENT_ID}.mtm.sh` : `http://localhost:${port}`)
).replace(/\/$/, '');

const db = await createDb();
const { app, sentinel } = createApp({ db, baseUrl });
sentinel.start();

serve({ fetch: app.fetch, port, hostname: '0.0.0.0' }, () => {
  console.log(`Loxe on ${baseUrl} (db: ${db.engine})`);
});

process.on('SIGTERM', async () => {
  sentinel.stop();
  await db.close();
  process.exit(0);
});
