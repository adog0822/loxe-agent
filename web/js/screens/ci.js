// The GitHub workflow Loxe hands out (Integrations and Connect use the same text).
// It runs the action at the root of the Loxe repo (action.yml), which runs bin/loxe.js.
import { BASE } from '../api.js';

export function workflowYaml(agentId, minGrade = 'B') {
  const base = BASE === 'https://loxeagent.loxeai.com' ? '' : `\n          base-url: ${BASE}`;
  return `name: Loxe
on:
  pull_request:
  deployment_status:
jobs:
  loxe:
    if: github.event_name == 'pull_request' || github.event.deployment_status.state == 'success'
    runs-on: ubuntu-latest
    steps:
      - uses: adog0822/loxe-agent@main
        with:
          api-key: \${{ secrets.LOXE_API_KEY }}
          agent-id: ${agentId || '<agent-id>'}
          min-grade: ${minGrade}${base}`;
}
