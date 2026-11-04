// #/agents/:id sends you to the right place: the live run, the report, or a first-run prompt.
import { loadAgent } from './common.js';

export async function render(main, ctx) {
  const { agent, run } = await loadAgent(ctx.params[0]);
  if (!ctx.alive()) return;
  if (run && (run.status === 'queued' || run.status === 'running')) location.replace(`#/runs/${run.id}`);
  else location.replace(`#/agents/${agent.id}/report`);
}
