// LOXE SERVER ENTRY POINT
import { serve } from '@hono/node-server';
import { createApp } from './app/index.js';
import { createSentinel } from './sentinel/index.js';
import { registerWithKeiki, keikiAgentConfig } from './integrations/keiki.js';

const port = parseInt(process.env.PORT || '3000', 10);
const { app, pool } = createApp();

// Mount sentinel routes on the same app
const sentinel = createSentinel();
app.route('/', sentinel.app);

// Keiki agent config endpoint
app.get('/keiki/config', (c) => {
  const baseUrl = process.env.LOXE_BASE_URL || `http://localhost:${port}`;
  return c.json(keikiAgentConfig(baseUrl));
});

serve({ fetch: app.fetch, port }, async () => {
  console.log(`🔒 Loxe running on port ${port}`);

  // Register with Keiki on startup (best-effort)
  const baseUrl = process.env.LOXE_BASE_URL || `http://localhost:${port}`;
  await registerWithKeiki(baseUrl);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down…');
  await pool.end();
  await sentinel.pool.end();
  process.exit(0);
});
