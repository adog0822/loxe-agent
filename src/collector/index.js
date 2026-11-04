// COLLECTOR — talks to the target agent and captures raw transcripts.
// Supports four probe kinds: turns (conversation), raw (malformed HTTP),
// burst (rapid-fire for rate-limit checks), and inventory (metadata fetch).
// Every response is captured as-is; the Collector never interprets pass/fail.

const DEFAULT_TIMEOUT = 30000;

export class Collector {
  constructor({ targetUrl, headers = {}, timeout = DEFAULT_TIMEOUT }) {
    this.targetUrl = targetUrl.replace(/\/$/, '');
    this.headers = { 'Content-Type': 'application/json', ...headers };
    this.timeout = timeout;
  }

  // ── turns: multi-turn conversation ───────────────────────────────────────
  async collectTurns(probe) {
    const turns = [];
    const messages = []; // running conversation context
    for (const turn of probe.turns || []) {
      messages.push({ role: 'user', content: turn.message });
      const start = Date.now();
      try {
        const res = await fetch(this.targetUrl, {
          method: 'POST',
          headers: this.headers,
          body: JSON.stringify({ messages }),
          signal: AbortSignal.timeout(this.timeout),
        });
        const latencyMs = Date.now() - start;
        const body = await res.text();
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          parsed = null;
        }
        const text =
          parsed?.choices?.[0]?.message?.content ??
          parsed?.response ??
          parsed?.text ??
          parsed?.message ??
          body;
        const tool_calls = parsed?.choices?.[0]?.message?.tool_calls ?? parsed?.tool_calls ?? undefined;
        turns.push({
          text: String(text),
          status: res.status,
          httpStatus: res.status,
          latencyMs,
          ...(tool_calls ? { tool_calls } : {}),
        });
        messages.push({ role: 'assistant', content: String(text) });
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
      const res = await fetch(this.targetUrl, {
        method: 'POST',
        headers: { ...this.headers, ...(raw.contentType ? { 'Content-Type': raw.contentType } : {}) },
        body: raw.body ?? '',
        signal: AbortSignal.timeout(this.timeout),
      });
      const latencyMs = Date.now() - start;
      const body = await res.text();
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
            const res = await fetch(this.targetUrl, {
              method: 'POST',
              headers: this.headers,
              body: JSON.stringify({ messages: [{ role: 'user', content: burst.message }] }),
              signal: AbortSignal.timeout(this.timeout),
            });
            const latencyMs = Date.now() - start;
            const body = await res.text();
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
      const res = await fetch(`${this.targetUrl}/.well-known/agent.json`, {
        headers: this.headers,
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json();
        Object.assign(inventory, data);
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
