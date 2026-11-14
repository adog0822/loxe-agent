// ENDPOINT CHECK — before an agent is added, send it one harmless message and say plainly whether
// it is a chat endpoint Loxe can test. Catches the usual mix-ups (a GitHub repo, a homepage, a
// database console, a route that wants a login) before anyone waits on 40 tests that all come
// back undecided. Also picks the request shape: OpenAI-style messages, or Vercel AI SDK v5 parts.
import { fetch as undiciFetch } from 'undici';
import { assertProbeable, guardedDispatcher } from './guard.js';
import { chatBody } from './index.js';
import { decodeReply } from './reply.js';

const HELLO = 'Hi, this is Loxe checking that this endpoint answers chat messages. A one-line hello back is perfect.';
const TIMEOUT = 20_000;
const MAX = 32 * 1024;

// Hosts that are never a chat endpoint, with what people usually meant to paste instead.
const NOT_AGENTS = [
  [/(^|\.)github\.com$|(^|\.)gitlab\.com$|(^|\.)bitbucket\.org$/, 'repo',
    "That's a code repo. Code sitting on GitHub can't answer messages. Loxe needs the URL of the running agent, the one your app sends chat messages to."],
  [/(^|\.)vercel\.com$|(^|\.)netlify\.com$|(^|\.)render\.com$|(^|\.)railway\.app$|dash\.cloudflare\.com$/, 'dashboard',
    "That's a hosting dashboard, not your agent. Open your deployed app and find the API route it chats through, often something like https://your-app.vercel.app/api/chat."],
  [/console\.aws\.amazon\.com$|(^|\.)athena\.[a-z0-9-]+\.amazonaws\.com$|portal\.azure\.com$|console\.cloud\.google\.com$/, 'console',
    "That's a cloud console or a database service like Athena. Neither is something you can chat with. If your agent runs on AWS, use its API Gateway or Lambda function URL."],
  [/(^|\.)chatgpt\.com$|(^|\.)chat\.openai\.com$|(^|\.)claude\.ai$|(^|\.)gemini\.google\.com$|(^|\.)poe\.com$/, 'chat_app',
    "That's a chat app's web page. It has no API Loxe can call. Custom GPTs and Claude projects work with the by-hand test instead."],
  [/(^|\.)huggingface\.co$/, 'model_page',
    "That's a Hugging Face page. If it's a Space with an API, use the API URL, not the page."],
];

async function send(url, headers, wire) {
  const res = await undiciFetch(url, {
    method: 'POST',
    redirect: 'manual',
    dispatcher: guardedDispatcher(),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream;q=0.9, */*;q=0.5', ...headers },
    body: JSON.stringify(chatBody([{ role: 'user', content: HELLO }], wire)),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  const chunks = [];
  let size = 0;
  if (res.body) {
    for await (const chunk of res.body) {
      chunks.push(chunk);
      size += chunk.length;
      if (size >= MAX) break;
    }
  }
  const body = Buffer.concat(chunks).subarray(0, MAX).toString('utf8');
  return { res, body, reply: decodeReply(body, res.headers.get('content-type')) };
}

const snippet = (s, n = 240) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const verdict = (ok, kind, title, detail, extra = {}) => ({ ok, kind, title, detail, ...extra });

export async function checkEndpoint({ url, headers = {} }) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch {}
  if (!u || !/^https?:$/.test(u.protocol)) {
    return verdict(false, 'invalid', "That doesn't look like a URL.", 'Paste the full address, starting with https://.');
  }
  for (const [pattern, kind, detail] of NOT_AGENTS) {
    if (pattern.test(u.hostname)) return verdict(false, kind, 'Not an agent endpoint.', detail);
  }
  try {
    await assertProbeable(u.toString());
  } catch (err) {
    return verdict(false, 'private', "Loxe can't reach that address.", `${err.message}. Loxe only tests agents on the public internet, so a localhost or office-network URL won't work. Deploy it somewhere public (a staging copy is ideal) or use the by-hand test.`);
  }

  let first;
  try {
    first = await send(u.toString(), headers, 'messages');
  } catch (err) {
    const timeout = /abort|timeout/i.test(err.name + err.message);
    return verdict(false, 'unreachable', timeout ? 'It never answered.' : "Couldn't connect.",
      timeout ? 'Loxe waited 20 seconds and got nothing back. Is the agent awake? Free-tier hosts often sleep, so try again in a minute.' : `${snippet(err.cause?.message || err.message, 160)}. Check the URL for typos and make sure the server is up.`);
  }
  let { res, reply } = first;
  let wire = 'messages';

  // AI SDK v5 routes reject the OpenAI shape with a 400 or 500. Try the parts shape before giving up.
  if ([400, 415, 422, 500].includes(res.status)) {
    try {
      const second = await send(u.toString(), headers, 'ui-messages');
      if (second.res.ok && second.reply.text.trim()) ({ res, reply } = second), (wire = 'ui-messages');
    } catch { /* keep the first answer */ }
  }

  const s = res.status;
  if (s >= 300 && s < 400) {
    const loc = res.headers.get('location');
    return verdict(false, 'redirect', 'It sent Loxe somewhere else.', `The server answered with a redirect${loc ? ` to ${snippet(loc, 120)}` : ''}. Loxe doesn't follow redirects, so paste the final address instead.${u.protocol === 'http:' ? ' Switching http:// to https:// often fixes this.' : ''}`);
  }
  if (s === 401 || s === 403) {
    return verdict(false, 'auth', 'It wants a login.', `The endpoint answered ${s}. Add the header your app sends, usually Authorization: Bearer ..., under "Add an auth header". It's encrypted and never shown again.`);
  }
  if (s === 404) {
    const bare = u.pathname === '/' || u.pathname === '';
    return verdict(false, 'not_found', 'Nothing lives at that path.', bare
      ? "That's the root of the site. Agents usually listen on a route like /api/chat, /chat or /v1/chat/completions. Check your code for the route your frontend calls."
      : 'The server is up, but that route returned 404. Double-check the path against your code.');
  }
  if (s === 405) {
    return verdict(false, 'method', "It doesn't take messages.", "That URL won't accept a POST. It's probably a web page rather than the API behind it. Find the route your chat box sends messages to.");
  }
  if (s === 429) {
    return verdict(true, 'rate_limited', 'Rate limited, which is fine.', "It told Loxe to slow down (429). That's good security hygiene. The test paces itself, but expect a few replies to come back undecided.", { wire, format: reply.format });
  }
  if (s >= 500) {
    return verdict(false, 'server_error', 'The agent crashed on a simple hello.', `It answered ${s}${reply.text ? `: "${snippet(reply.text, 160)}"` : ''}. Loxe sends POST {"messages":[{"role":"user","content":"..."}]}. If your route expects a different body, that's the likely cause.`);
  }
  if (s >= 400) {
    return verdict(false, 'bad_request', "It didn't like the message format.", `It answered ${s}${reply.text ? `: "${snippet(reply.text, 160)}"` : ''}. Loxe sends OpenAI-style {"messages":[...]} and also tried the Vercel AI SDK shape. If your agent expects something else, wrap it in a small route that accepts messages.`);
  }
  if (reply.format === 'html') {
    return verdict(false, 'website', "That's a web page, not an API.", 'Loxe got HTML back, the kind of thing a browser renders. Paste the API route your chat box calls instead, often /api/chat on the same domain.');
  }
  if (reply.format === 'json-unknown') {
    return verdict(false, 'unrecognized', "It answered, but Loxe can't find the reply in it.", `It sent back JSON without a field Loxe knows to read: ${snippet(reply.text, 160)}. Put the agent's reply in response, text or message (or use the OpenAI shape). You can still add it, and Loxe will judge the raw JSON.`);
  }
  if (!reply.text.trim() && !reply.tool_calls) {
    return verdict(false, 'empty', 'It answered, but said nothing.', 'The request worked (200) but there was no text in the reply. Loxe reads OpenAI, Anthropic and Vercel AI SDK replies, streamed or not, plus plain { "response" | "text" | "message" }.');
  }
  const how = wire === 'ui-messages' ? ' Looks like a Vercel AI SDK route, so Loxe will talk to it in that format.' : '';
  return verdict(true, 'chat', 'It talks. Ready to test.', (u.protocol === 'http:'
    ? "It answered a hello. One heads-up: it's on plain http, so the HTTPS test will fail and cap the grade at D."
    : 'It answered a hello. Loxe can run all 40 tests against it.') + how, {
    wire,
    format: reply.format,
    sample: snippet(reply.text, 280),
    toolsVisible: !!reply.tool_calls,
  });
}
