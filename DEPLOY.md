# Deploying Loxe on Maritime

## Prerequisites

- Maritime account with API key (`mk_...`)
- GitHub repo: https://github.com/adog0822/loxe-agent
- Supabase project: `mgoicirvlkqoxysebdzi` (schema already applied)

## Step 1: Push code to GitHub

```bash
cd loxe
git remote set-url origin https://github.com/adog0822/loxe-agent.git
git push -u origin main
```

## Step 2: Create the agent on Maritime

Using the Maritime CLI:

```bash
maritime create loxe --repo https://github.com/adog0822/loxe-agent
```

Or via the API:

```bash
curl -X POST https://api.maritime.sh/api/agents \
  -H "Authorization: Bearer $MARITIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "loxe",
    "framework": "custom",
    "githubRepo": "https://github.com/adog0822/loxe-agent",
    "exposedPort": 3000,
    "description": "Deterministic agent clearance system",
    "env": [
      {"key": "DATABASE_URL", "value": "<your-supabase-connection-string>"},
      {"key": "KEIKI_API_KEY", "value": "<your-keiki-key>"},
      {"key": "SUPERMEMORY_API_KEY", "value": "<your-supermemory-key>"},
      {"key": "MARITIME_API_KEY", "value": "<your-maritime-key>"}
    ]
  }'
```

Or via the SDK:

```javascript
import { Maritime } from 'maritime-sdk';

const m = new Maritime({ apiKey: process.env.MARITIME_API_KEY });
const agent = await m.agents.create({
  name: 'loxe',
  template: 'custom',
  githubRepo: 'https://github.com/adog0822/loxe-agent',
  exposedPort: 3000,
  description: 'Deterministic agent clearance system',
  env: [
    { key: 'DATABASE_URL', value: process.env.DATABASE_URL },
    { key: 'KEIKI_API_KEY', value: process.env.KEIKI_API_KEY },
    { key: 'SUPERMEMORY_API_KEY', value: process.env.SUPERMEMORY_API_KEY },
  ],
});
console.log('Deployed:', agent.id);
```

## Step 3: Set LOXE_BASE_URL

After deployment, Maritime assigns a URL. Set it as an env var:

```bash
maritime env set LOXE_BASE_URL https://<your-agent-url>.maritime.sh
```

## Step 4: Verify

```bash
# Health check
curl https://<your-agent-url>.maritime.sh/health

# Register a target agent
curl -X POST https://<your-agent-url>.maritime.sh/agents \
  -H "Content-Type: application/json" \
  -d '{"name": "my-agent", "url": "https://my-agent.example.com"}'

# Trigger a clearance run
curl -X POST https://<your-agent-url>.maritime.sh/agents/<agent-id>/run
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Supabase Postgres connection string |
| `PORT` | No | Server port (default: 3000, Maritime injects this) |
| `LOXE_BASE_URL` | No | Public URL for badge links and Keiki registration |
| `KEIKI_API_KEY` | No | Keiki integration key |
| `SUPERMEMORY_API_KEY` | No | Supermemory per-org memory key |
| `MARITIME_API_KEY` | No | For SDK features within the agent |
| `LOXE_PROBE_LIBRARY` | No | Custom probe library path (default: probes/library.example.json) |

## Maritime Contract Compliance

Loxe satisfies the Maritime agent contract:
- ✅ Binds on `0.0.0.0:$PORT`
- ✅ `GET /health` → 200
- ✅ `POST /chat` → `{ "response": "..." }`
- ✅ Dockerfile at repo root
- ✅ Node 22 Alpine image
