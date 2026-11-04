// GUIDED DEMO BACKING — the owl-guided demo shows a real clearance, not screenshots.
// Loxe hosts the HelixDesk demo agent in-process at /demo/agent and clears it once per probe-library
// version in a dedicated "demo" org, so the demo's PDF, public page and ledger are real and verifiable.
import { loadLibrary } from '../probes/library.js';

export const DEMO_ORG = 'demo';
export const DEMO_AGENT = 'agent-de0de0de0de0';

export function createDemo({ db, orchestrator, baseUrl }) {
  let pending;

  async function ensure() {
    const lib = loadLibrary();
    await db.query(`insert into orgs (id, name) values ($1, 'Loxe demo') on conflict (id) do nothing`, [DEMO_ORG]);
    await db.query(
      `insert into agents (id, name, url, headers, owner_id, org_id, source)
       values ($1, 'HelixDesk support agent (demo)', $2, '{}', 'demo', $3, 'url')
       on conflict (id) do update set url = excluded.url, archived_at = null`,
      [DEMO_AGENT, `${baseUrl}/demo/agent`, DEMO_ORG]
    );
    const agent = (await db.query(`select * from agents where id = $1`, [DEMO_AGENT])).rows[0];
    const last = agent.last_run_id
      ? (await db.query(`select id, status, library_hash from runs where id = $1`, [agent.last_run_id])).rows[0]
      : null;
    if (last?.status === 'completed' && last.library_hash === lib.hash) return { agentId: DEMO_AGENT, runId: last.id };
    const { runId, done } = await orchestrator.enqueue(agent, { trigger: 'demo' });
    await done;
    return { agentId: DEMO_AGENT, runId };
  }

  // One clearance at a time; callers share the in-flight one.
  const ids = () => (pending ||= ensure().finally(() => (pending = null)));
  return { ids };
}
