// COLLECTOR — talks to the target agent and captures raw transcripts.
// Supports four probe kinds: turns (conversation), raw (malformed HTTP),
// burst (rapid-fire for rate-limit checks), and inventory (metadata fetch).
// Every response is captured as-is; the Collector never interprets pass/fail.

import { fetch as undiciFetch } from 'undici';
import { guardedDispatcher } from './guard.js';
import { decodeReply } from './reply.js';

// How chat messages are sent. 'messages' is the OpenAI shape most agents accept; 'ui-messages' is
// the Vercel AI SDK v5 shape (useChat routes), whose messages carry `parts` instead of `content`.
export const WIRE_FORMATS = ['messages', 'ui-messages'];
export function chatBody(messages, wire = 'messages') {
  if (wire === 'ui-messages') {
    return {
      id: 'loxe',
      messages: messages.map((m, i) => ({ id: `m${i}`, role: m.role, parts: [{ type: 'text', text: m.content }] })),
      trigger: 'submit-message',
    };
  }
  return { messages };
}

const DEFAULT_TIMEOUT = 30000;
const MAX_BODY = 64 * 1024; // replies are judged on at most 64 KB; the rest is dropped unread

// Every request: guarded DNS (no private addresses even after rebinding), never follow redirects.
const guardedFetch = (url, opts) => undiciFetch(url, { ...opts, redirect: 'manual', dispatcher: guardedDispatcher() });

async function readCapped(res, max = MAX_BODY) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size >= max) {
      await reader.cancel().catch(() => {});
      break;
    }
  }
  return Buffer.concat(chunks).subarray(0, max).toString('utf8');
}

export class Collector {
  constructor({ targetUrl, headers = {}, timeout = DEFAULT_TIMEOUT, wire = 'messages' }) {
    this.targetUrl = targetUrl.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream;q=0.9, */*;q=0.5', ...headers };
    this.timeout = timeout;
    this.wire = WIRE_FORMATS.includes(wire) ? wire : 'messages';
  }

  // ── turns: multi-turn conversation ───────────────────────────────────────
  async collectTurns(probe) {
    const turns = [];
    const messages = []; // running conversation context
    for (const turn of probe.turns || []) {
      messages.push({ role: 'user', content: turn.message });
      const start = Date.now();
      try {
        const res = await guardedFetch(this.targetUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify(chatBody(messages, this.wire)),
          signal: AbortSignal.timeout(this.timeout),
        });
        const latencyMs = Date.now() - start; // time to first response, as before streaming support
        const body = await readCapped(res);
        const { text, tool_calls, format } = decodeReply(body, res.headers.get('content-type'));
        turns.push({
          text,
          status: res.status,
          httpStatus: res.status,
          latencyMs,
          replyFormat: format,
          ...(tool_calls ? { tool_calls } : {}),
        });
        messages.push({ role: 'assistant', content: text });
      } catch (err) {
        turns.push({
          text: '',
          status: 0,
          httpStatus: 0,
          latencyMs: Date.now() - start,
          error: err.message,
        });
      }
    }
    return { turns, url: this.targetUrl };
  }

  // ── raw: send a malformed/custom HTTP body ───────────────────────────────
  async collectRaw(probe) {
    const raw = probe.raw || {};
    const start = Date.now();
    try {
      const res = await guardedFetch(this.targetUrl, {
        method: 'POST',
        headers: { ...this.headers, ...(raw.contentType ? { 'Content-Type': raw.contentType } : {}) },
        body: raw.body ?? '',
        signal: AbortSignal.timeout(this.timeout),
      });
      const latencyMs = Date.now() - start;
      const body = await readCapped(res);
      return {
        turns: [{ text: body, status: res.status, httpStatus: res.status, latencyMs }],
        url: this.targetUrl,
      };
    } catch (err) {
      return {
        turns: [{ text: '', status: 0, httpStatus: 0, latencyMs: Date.now() - start, error: err.message }],
        url: this.targetUrl,
        error: err.message,
      };
    }
  }

  // ── burst: rapid-fire requests for rate-limit detection ──────────────────
  async collectBurst(probe) {
    const burst = probe.burst || { count: 10, message: 'ping' };
    const turns = [];
    const promises = [];
    for (let i = 0; i < burst.count; i++) {
      promises.push(
        (async () => {
          const start = Date.now();
          try {
            const res = await guardedFetch(this.targetUrl, {
              method: 'POST',
              headers: this.headers,
              body: JSON.stringify(chatBody([{ role: 'user', content: burst.message }], this.wire)),
              signal: AbortSignal.timeout(this.timeout),
            });
            const latencyMs = Date.now() - start;
            const body = await readCapped(res);
            return { text: body, status: res.status, httpStatus: res.status, latencyMs };
          } catch (err) {
            return { text: '', status: 0, httpStatus: 0, latencyMs: Date.now() - start, error: err.message };
          }
        })()
      );
    }
    const results = await Promise.all(promises);
    return { turns: results, url: this.targetUrl };
  }

  // ── inventory: fetch agent metadata ──────────────────────────────────────
  async collectInventory() {
    const inventory = { url: this.targetUrl };
    // Try well-known agent manifest
    try {
      const res = await guardedFetch(`${this.targetUrl}/.well-known/agent.json`, {
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = JSON.parse(await readCapped(res, 16 * 1024));
        Object.assign(inventory, data);
        inventory.url = this.targetUrl; // the manifest must not override the endpoint we actually probed
      }
    } catch {
      // no manifest — that's a valid finding
    }
    return inventory;
  }

  // ── dispatch by probe kind ───────────────────────────────────────────────
  async collect(probe) {
    const kind = probe.kind || 'turns';
    switch (kind) {
      case 'turns':
        return this.collectTurns(probe);
      case 'raw':
        return this.collectRaw(probe);
      case 'burst':
        return this.collectBurst(probe);
      case 'inventory':
        return { turns: [], url: this.targetUrl };
      default:
        return { turns: [], url: this.targetUrl, error: `unknown kind: ${kind}` };
    }
  }
}
