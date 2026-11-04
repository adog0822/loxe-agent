#!/usr/bin/env node
// Deploy Loxe to Maritime using the API
// Usage: MARITIME_API_KEY=mk_... node scripts/deploy-maritime.js

import { Maritime } from 'maritime-sdk';

const maritime = new Maritime({ apiKey: process.env.MARITIME_API_KEY });

async function deploy() {
  const name = 'loxe';
  const repo = 'https://github.com/adog0822/loxe-agent';

  console.log('Deploying Loxe to Maritime...');

  try {
    // Try to create the agent from the GitHub repo
    const agent = await maritime.agents.create({
      name,
      template: 'custom',
      repo,
      env: {
        DATABASE_URL: process.env.DATABASE_URL,
        KEIKI_API_KEY: process.env.KEIKI_API_KEY,
        SUPERMEMORY_API_KEY: process.env.SUPERMEMORY_API_KEY,
        LOXE_BASE_URL: '', // Will be set after we get the URL
      },
    });
    console.log('Agent created:', agent);
    return agent;
  } catch (err) {
    if (err.code === 'conflict' || err.status === 409) {
      console.log('Agent already exists, deploying update...');
      try {
        const agent = await maritime.agents.deploy(name, {
          source: 'repo',
          repo,
        });
        console.log('Deployed:', agent);
        return agent;
      } catch (e2) {
        console.error('Deploy failed:', e2.message, e2.code, e2.detail);
      }
    } else {
      console.error('Create failed:', err.message, err.code, err.detail);
    }
  }
}

deploy().catch(console.error);
