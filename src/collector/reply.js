// REPLY DECODER — turns whatever an agent sent back into { text, tool_calls, format }.
// Pure: no network, no clock. The verifier judges `text` and `tool_calls`, so this is where a
// streamed or nested reply must be stitched back together. A rule like "must not contain
// LX-CANARY-7731" has to see the whole sentence, not 40 separate tokens.
//
// Understood:
//   JSON      OpenAI chat (choices[].message), OpenAI responses (output_text / output[]),
//             Anthropic messages (content[] blocks), and plain { response | text | message |
//             output | answer | reply | content | messages[] }
//   SSE       OpenAI chat chunks (delta.content, delta.tool_calls), OpenAI responses events,
//             Anthropic events, Vercel AI SDK v5 UI message stream (text-delta, tool-input-*)
//   AI SDK v4 data stream lines (0:"text", 9:{tool call})
//   NDJSON    one JSON object per line (Ollama and friends)
//   anything else is plain text
// Tool calls come out as { name, args, ...original } whatever shape they arrived in.

const MAX_TEXT = 64 * 1024;

export function normalizeToolCall(c) {
  if (!c || typeof c !== 'object') return null;
  const name = c.name ?? c.function?.name ?? c.toolName ?? c.tool_name ?? c.tool ?? null;
  let args = c.args ?? c.input ?? c.arguments ?? c.function?.arguments ?? c.parameters ?? {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { /* keep the raw string; rules stringify it anyway */ }
  }
  return { ...c, name: name == null ? '' : String(name), args };
}

const normCalls = (list) => (Array.isArray(list) ? list.map(normalizeToolCall).filter(Boolean) : undefined);

// Text from a content value that may be a string, an array of parts, or a nested object.
function contentText(v) {
  if (v == null) return null;
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) {
    const parts = v.map((p) => (typeof p === 'string' ? p : p?.type === 'text' || p?.type === 'output_text' ? p.text : p?.text ?? null)).filter((x) => typeof x === 'string');
    return parts.length ? parts.join('') : null;
  }
  if (typeof v === 'object') return contentText(v.content ?? v.text ?? null);
  return String(v);
}

// One complete JSON body.
function fromJson(j) {
  if (j == null || typeof j !== 'object') return null;
  // OpenAI chat completions
  const choice = Array.isArray(j.choices) ? j.choices[0] : null;
  if (choice) {
    const m = choice.message || {};
    return { text: contentText(m.content) ?? choice.text ?? '', tool_calls: normCalls(m.tool_calls ?? (m.function_call ? [m.function_call] : undefined)), format: 'openai' };
  }
  // OpenAI responses API
  if (typeof j.output_text === 'string' || Array.isArray(j.output)) {
    const items = Array.isArray(j.output) ? j.output : [];
    const text = typeof j.output_text === 'string' ? j.output_text
      : items.filter((o) => o.type === 'message').map((o) => contentText(o.content) || '').join('');
    const calls = items.filter((o) => o.type === 'function_call');
    return { text, tool_calls: calls.length ? normCalls(calls) : undefined, format: 'openai-responses' };
  }
  // Anthropic messages
  if (Array.isArray(j.content) && j.content.some((b) => b && typeof b === 'object' && 'type' in b)) {
    const text = j.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    const calls = j.content.filter((b) => b.type === 'tool_use');
    return { text, tool_calls: calls.length ? normCalls(calls) : (j.tool_calls ? normCalls(j.tool_calls) : undefined), format: 'anthropic' };
  }
  // A list of messages back: take the last assistant one.
  if (Array.isArray(j.messages)) {
    const last = [...j.messages].reverse().find((m) => m?.role === 'assistant') || j.messages.at(-1);
    if (last) return { text: contentText(last.content ?? last.parts) ?? '', tool_calls: normCalls(last.tool_calls ?? j.tool_calls), format: 'json' };
  }
  for (const k of ['response', 'text', 'message', 'output', 'answer', 'reply', 'content', 'result', 'data']) {
    if (j[k] == null) continue;
    const t = contentText(j[k]);
    if (t != null) return { text: t, tool_calls: normCalls(j.tool_calls ?? j[k]?.tool_calls), format: 'json' };
  }
  return null;
}

// Server-sent events: one JSON payload per `data:` line.
function fromSse(body) {
  let text = '';
  const calls = new Map(); // index or id -> { name, args (string while streaming) }
  const whole = [];
  let format = 'sse';
  let seen = 0;
  for (const line of body.split(/\r?\n/)) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let e;
    try { e = JSON.parse(data); } catch { continue; }
    seen++;
    // OpenAI chat chunk
    const ch = Array.isArray(e.choices) ? e.choices[0] : null;
    if (ch) {
      format = 'openai-stream';
      const d = ch.delta || ch.message || {};
      if (typeof d.content === 'string') text += d.content;
      else if (typeof ch.text === 'string') text += ch.text;
      for (const tc of d.tool_calls || []) {
        const key = tc.index ?? tc.id ?? calls.size;
        const cur = calls.get(key) || { name: '', args: '' };
        if (tc.function?.name) cur.name += tc.function.name;
        if (typeof tc.function?.arguments === 'string') cur.args += tc.function.arguments;
        if (tc.id) cur.id = tc.id;
        calls.set(key, cur);
      }
      continue;
    }
    switch (e.type) {
      // Vercel AI SDK v5 UI message stream
      case 'text-delta': format = 'ai-sdk-stream'; text += e.delta ?? e.textDelta ?? ''; break;
      case 'tool-input-available': case 'tool-call':
        format = 'ai-sdk-stream'; whole.push({ id: e.toolCallId, name: e.toolName, args: e.input ?? e.args ?? {} }); break;
      // Anthropic
      case 'content_block_start':
        format = 'anthropic-stream';
        if (e.content_block?.type === 'tool_use') calls.set(e.index, { name: e.content_block.name || '', args: '' });
        if (e.content_block?.type === 'text' && e.content_block.text) text += e.content_block.text;
        break;
      case 'content_block_delta':
        format = 'anthropic-stream';
        if (e.delta?.type === 'text_delta') text += e.delta.text || '';
        if (e.delta?.type === 'input_json_delta') {
          const cur = calls.get(e.index) || { name: '', args: '' };
          cur.args += e.delta.partial_json || '';
          calls.set(e.index, cur);
        }
        break;
      // OpenAI responses API
      case 'response.output_text.delta': format = 'openai-responses-stream'; text += e.delta || ''; break;
      case 'response.output_item.done':
        if (e.item?.type === 'function_call') whole.push(e.item);
        break;
      default: {
        // Some servers stream complete JSON objects; others put plain { text } per event.
        const full = fromJson(e);
        if (full && !e.type) text += full.text;
      }
    }
  }
  if (!seen) return null;
  const tool_calls = [...calls.values(), ...whole].map(normalizeToolCall).filter(Boolean);
  return { text, tool_calls: tool_calls.length ? tool_calls : undefined, format };
}

// Vercel AI SDK v4 data stream: `0:"text"`, `9:{toolCallId,toolName,args}`, `3:"error"`.
function fromDataStream(body) {
  let text = '';
  const tool_calls = [];
  let seen = 0;
  for (const line of body.split(/\r?\n/)) {
    const m = /^([0-9a-z]):(.*)$/.exec(line);
    if (!m) continue;
    let v;
    try { v = JSON.parse(m[2]); } catch { continue; }
    seen++;
    if (m[1] === '0' && typeof v === 'string') text += v;
    if (m[1] === '9' && v && typeof v === 'object') tool_calls.push(normalizeToolCall({ id: v.toolCallId, name: v.toolName, args: v.args }));
    if (m[1] === '3' && typeof v === 'string') text += v;
  }
  return seen ? { text, tool_calls: tool_calls.length ? tool_calls : undefined, format: 'ai-sdk-data-stream' } : null;
}

// Newline-delimited JSON (Ollama streams one object per line).
function fromNdjson(body) {
  const lines = body.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  let text = '';
  const calls = [];
  for (const l of lines) {
    let j;
    try { j = JSON.parse(l); } catch { return null; }
    const piece = j?.message?.content ?? j?.response ?? j?.text ?? j?.delta ?? null;
    if (typeof piece === 'string') text += piece;
    for (const c of j?.message?.tool_calls || j?.tool_calls || []) calls.push(normalizeToolCall(c));
  }
  return { text, tool_calls: calls.length ? calls.filter(Boolean) : undefined, format: 'ndjson' };
}

export function decodeReply(body, contentType = '') {
  const raw = String(body ?? '');
  const ct = String(contentType || '').toLowerCase();
  const trimmed = raw.trimStart();
  let out = null;
  if (ct.includes('event-stream') || /^(data|event|id):/m.test(trimmed.slice(0, 200))) out = fromSse(raw);
  if (!out && /^[0-9a-z]:["{[]/.test(trimmed)) out = fromDataStream(raw);
  if (!out && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
    try {
      // Parsed but no reply field Loxe knows: judge the raw JSON, and say so.
      out = fromJson(JSON.parse(trimmed)) || { text: raw, format: 'json-unknown' };
    } catch { out = fromNdjson(raw); }
  }
  if (!out && ct.includes('ndjson')) out = fromNdjson(raw);
  if (!out) out = { text: raw, format: ct.includes('html') || /^<!doctype html|^<html/i.test(trimmed) ? 'html' : 'text' };
  out.text = String(out.text ?? '').slice(0, MAX_TEXT);
  if (!out.tool_calls) delete out.tool_calls;
  return out;
}
