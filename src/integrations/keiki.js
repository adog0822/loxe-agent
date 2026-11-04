// KEIKI INTEGRATION
// Keiki is the "front door" — an agent-as-model interface that provides:
// 1. Agent configuration for Loxe as a Keiki-accessible tool
// 2. Approval-gated webhook tools (run clearance, view reports)
// 3. Notifications on grade changes and sentinel alerts
//
// This module produces the Keiki agent config and provides helper functions
// for interacting with the Keiki API.

const KEIKI_BASE = process.env.KEIKI_API_URL || 'https://api.onkeiki.com';
const KEIKI_KEY = process.env.KEIKI_API_KEY || '';

// ── Keiki agent configuration ──────────────────────────────────────────────
// This describes Loxe as a tool that Keiki can invoke.
export function keikiAgentConfig(loxeBaseUrl) {
  return {
    name: 'loxe',
    displayName: 'Loxe Agent Clearance',
    description:
      'Deterministic safety and compliance clearance for AI agents. ' +
      'Runs frozen probe batteries, produces hash-chained evidence, and grades agents A–F.',
    version: '0.1.0',
    actions: [
      {
        name: 'run_clearance',
        description: 'Run a full clearance battery against a registered agent.',
        requiresApproval: true,
        endpoint: {
          method: 'POST',
          url: `${loxeBaseUrl}/agents/{agentId}/run`,
        },
        parameters: {
          agentId: { type: 'string', description: 'The agent ID to clear', required: true },
        },
      },
      {
        name: 'view_clearance',
        description: 'View the latest clearance report for an agent.',
        requiresApproval: false,
        endpoint: {
          method: 'GET',
          url: `${loxeBaseUrl}/clearance/{agentId}`,
        },
        parameters: {
          agentId: { type: 'string', description: 'The agent ID', required: true },
        },
      },
      {
        name: 'verify_ledger',
        description: 'Verify the integrity of an agent\'s evidence chain.',
        requiresApproval: false,
        endpoint: {
          method: 'GET',
          url: `${loxeBaseUrl}/verify/{agentId}`,
        },
        parameters: {
          agentId: { type: 'string', description: 'The agent ID', required: true },
        },
      },
      {
        name: 'list_agents',
        description: 'List all registered agents and their current grades.',
        requiresApproval: false,
        endpoint: {
          method: 'GET',
          url: `${loxeBaseUrl}/agents`,
        },
      },
      {
        name: 'download_report',
        description: 'Download a PDF clearance report for a specific run.',
        requiresApproval: false,
        endpoint: {
          method: 'GET',
          url: `${loxeBaseUrl}/report/{runId}/pdf`,
        },
        parameters: {
          runId: { type: 'string', description: 'The run ID', required: true },
        },
      },
      {
        name: 'enable_sentinel',
        description: 'Enable continuous monitoring (sentinel) for an agent.',
        requiresApproval: true,
        endpoint: {
          method: 'POST',
          url: `${loxeBaseUrl}/sentinel/agents/{agentId}/enable`,
        },
        parameters: {
          agentId: { type: 'string', description: 'The agent ID', required: true },
          intervalHours: { type: 'number', description: 'Re-run interval in hours', default: 24 },
        },
      },
    ],
    webhooks: {
      gradeChange: {
        description: 'Fires when an agent\'s grade changes after a clearance run.',
        payload: {
          type: 'grade_change',
          agentId: 'string',
          agentName: 'string',
          oldGrade: 'string',
          newGrade: 'string',
          direction: 'improved | degraded',
        },
      },
    },
  };
}

// ── Register Loxe with Keiki ───────────────────────────────────────────────
export async function registerWithKeiki(loxeBaseUrl) {
  if (!KEIKI_KEY) {
    console.log('No KEIKI_API_KEY — skipping Keiki registration');
    return null;
  }

  const config = keikiAgentConfig(loxeBaseUrl);
  try {
    const res = await fetch(`${KEIKI_BASE}/api/agents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEIKI_KEY}`,
      },
      body: JSON.stringify(config),
    });
    if (res.ok) {
      const data = await res.json();
      console.log(`Registered with Keiki: ${data.id || 'ok'}`);
      return data;
    }
    console.log(`Keiki registration: ${res.status} ${await res.text()}`);
    return null;
  } catch (err) {
    console.log(`Keiki registration failed: ${err.message}`);
    return null;
  }
}

// ── Send notification to Keiki ─────────────────────────────────────────────
export async function sendKeikiNotification(notification) {
  if (!KEIKI_KEY) return;
  try {
    await fetch(`${KEIKI_BASE}/api/notifications`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${KEIKI_KEY}`,
      },
      body: JSON.stringify(notification),
    });
  } catch {
    // Best-effort
  }
}
