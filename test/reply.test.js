// Reply decoding: streamed and nested replies must be stitched back together before the verifier
// sees them, and tool calls must be found whatever shape they arrive in. The two end-to-end
// checks at the bottom are the bugs this exists for: a streamed canary leak and an OpenAI-shaped
// dangerous tool call both used to be graded as passes.
import http from 'node:http';
import { decodeReply, normalizeToolCall } from '../src/collector/reply.js';
import { Collector, chatBody } from '../src/collector/index.js';
import { evaluate } from '../src/verifier/index.js';
import library from '../probes/library.json' with { type: 'json' };

process.env.LOXE_ALLOW_PRIVATE_TARGETS = '1';

const ok = (cond, msg) => {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
  console.log('  ok', msg);
};
const sse = (events) => events.map((e) => `data: ${typeof e === 'string' ? e : JSON.stringify(e)}\n\n`).join('');

// ── shapes ──
let r = decodeReply(JSON.stringify({ choices: [{ message: { content: 'hello there' } }] }), 'application/json');
ok(r.text === 'hello there' && r.format === 'openai', 'OpenAI JSON');

r = decodeReply(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'delete_customer', arguments: '{"id":"C-1002"}' } }] } }] }));
ok(r.tool_calls?.[0].name === 'delete_customer' && r.tool_calls[0].args.id === 'C-1002', 'OpenAI tool_calls get a name and parsed args');

r = decodeReply(sse([
  { choices: [{ delta: { content: 'Your code is LX-' } }] },
  { choices: [{ delta: { content: 'CANARY' } }] },
  { choices: [{ delta: { content: '-7731.' } }] },
  '[DONE]',
]), 'text/event-stream');
ok(r.text === 'Your code is LX-CANARY-7731.' && r.format === 'openai-stream', 'OpenAI stream is stitched into one reply');

r = decodeReply(sse([
  { choices: [{ delta: { tool_calls: [{ index: 0, id: 't1', function: { name: 'dele', arguments: '{"id":' } }] } }] },
  { choices: [{ delta: { tool_calls: [{ index: 0, function: { name: 'te_user', arguments: '"C-1002"}' } }] } }] },
]), 'text/event-stream');
ok(r.tool_calls?.[0].name === 'delete_user' && r.tool_calls[0].args.id === 'C-1002', 'OpenAI streamed tool call is assembled');

r = decodeReply(sse([
  { type: 'start' }, { type: 'text-start', id: 'a' },
  { type: 'text-delta', id: 'a', delta: 'Sure, ' }, { type: 'text-delta', id: 'a', delta: 'done.' },
  { type: 'tool-input-available', toolCallId: 'x', toolName: 'sendEmail', input: { to: 'a@b.c' } },
  { type: 'finish' }, '[DONE]',
]), 'text/event-stream');
ok(r.text === 'Sure, done.' && r.tool_calls?.[0].name === 'sendEmail' && r.format === 'ai-sdk-stream', 'Vercel AI SDK v5 stream');

r = decodeReply('f:{"messageId":"m"}\n0:"Hel"\n0:"lo"\n9:{"toolCallId":"t","toolName":"refund","args":{"amount":500}}\ne:{"finishReason":"stop"}\n', 'text/plain');
ok(r.text === 'Hello' && r.tool_calls?.[0].name === 'refund' && r.format === 'ai-sdk-data-stream', 'Vercel AI SDK v4 data stream');

r = decodeReply(sse([
  { type: 'message_start', message: {} },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there' } },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', name: 'wire_money' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"amt":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '9}' } },
]), 'text/event-stream');
ok(r.text === 'Hi there' && r.tool_calls?.[0].name === 'wire_money' && r.tool_calls[0].args.amt === 9, 'Anthropic stream');

r = decodeReply(JSON.stringify({ content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', name: 'rm', input: { path: '/' } }] }));
ok(r.text === 'ok' && r.tool_calls?.[0].name === 'rm', 'Anthropic JSON with tool_use');

r = decodeReply(JSON.stringify({ output_text: 'from responses' }));
ok(r.text === 'from responses', 'OpenAI responses API');

r = decodeReply('{"message":{"role":"assistant","content":"Hi"},"done":false}\n{"message":{"role":"assistant","content":" you"},"done":true}\n', 'application/x-ndjson');
ok(r.text === 'Hi you' && r.format === 'ndjson', 'NDJSON stream (Ollama)');

r = decodeReply(JSON.stringify({ message: { role: 'assistant', content: 'nested' } }));
ok(r.text === 'nested', 'nested { message: { content } } is read, not "[object Object]"');

ok(decodeReply('{"response":"plain"}').text === 'plain', '{ response }');
ok(decodeReply('just words').text === 'just words', 'plain text');
ok(decodeReply('<!doctype html><html></html>', 'text/html').format === 'html', 'HTML is flagged as html');
ok(normalizeToolCall({ toolName: 'x', input: { a: 1 } }).name === 'x', 'AI SDK tool call shape');
ok(JSON.stringify(chatBody([{ role: 'user', content: 'q' }], 'ui-messages')).includes('"parts":[{"type":"text","text":"q"}]'), 'ui-messages body carries parts');

// ── end to end: real HTTP, real verifier ──
const probe = (id) => library.probes.find((p) => p.id === id);
const leaky = http.createServer(async (req, res) => {
  let b = '';
  for await (const ch of req) b += ch;
  const said = JSON.parse(b).messages.map((m) => m.content).join(' ');
  if (req.url === '/stream') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const code = /LX-CANARY-7731/.test(said) ? ['Your code is LX', '-CAN', 'ARY-77', '31'] : ['ok'];
    for (const piece of code) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
    return res.end('data: [DONE]\n\n');
  }
  // /tools: OpenAI-shaped tool call with only function.name, the way the real API returns it
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'delete_customer', arguments: '{"id":"C-1002"}' } }] } }] }));
});
await new Promise((ready) => leaky.listen(0, '127.0.0.1', ready));
const base = `http://127.0.0.1:${leaky.address().port}`;

const de04 = probe('DE-04');
const t1 = await new Collector({ targetUrl: `${base}/stream` }).collectTurns(de04);
ok(evaluate(de04.rule, t1).status === 'fail', 'streamed canary leak now FAILS DE-04 (it used to pass)');

const tp02 = probe('TP-02');
const t2 = await new Collector({ targetUrl: `${base}/tools` }).collectTurns(tp02);
ok(evaluate(tp02.rule, t2).status === 'fail', 'OpenAI-shaped delete tool call now FAILS TP-02 (it used to pass)');

leaky.close();
console.log('✓ reply decoding passed');
process.exit(0);
