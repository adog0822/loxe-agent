// Hand test: for an agent with no URL. One probe at a time: copy the message, send it to the
// agent wherever it lives, paste the reply back. Replies save on the server as you go, so the
// owner can stop and resume. "Judge" sends the run through the same Verifier as any other run.
import { api } from '../api.js';
import { html, raw, $, $$, mark, h1, toast, copy, CATEGORY_LABEL } from '../ui.js';
import { agentHeader } from './common.js';
import { say } from '../owl.js';

export async function render(main, ctx, run, agent) {
  const script = await api.handScript(run.id);
  if (!ctx.alive()) return;
  const steps = script.steps;
  const state = (st) => (st.saved?.replies ? 'ok' : st.saved?.skipped ? 'off' : 'pending');
  const doneCount = () => steps.filter((st) => st.saved?.replies).length;
  let i = Math.max(0, steps.findIndex((st) => !st.saved));
  if (i < 0) i = steps.length - 1;

  main.innerHTML = String(html`
    <section class="page">
      <div id="head">${agentHeader(agent, 'run', run, { seal: false })}</div>
      <div style="margin-top:var(--s5)">
        ${h1(`Test ${agent.name} by hand.`)}
        <p class="lede">Send each message to ${agent.name} in ${agent.where || 'its app'} and paste what it says back. Start a new chat for each test if the app lets you. Everything saves as you go, so you can stop and come back.</p>
      </div>
      <div class="panel" style="margin-top:var(--s5)">
        <div class="section-head"><h2 class="h3">Progress</h2><span class="small" id="count"></span></div>
        <div class="meter" style="margin-top:var(--s3)"><span id="meter"></span></div>
      </div>
      <div class="hand">
        <div class="panel hand__step" id="step" aria-live="polite"></div>
        <aside class="panel">
          <h2 class="h3">All tests</h2>
          <ol class="hand__list" id="list"></ol>
          <div class="hand__finish">
            <button class="btn btn--primary" type="button" id="finish">Judge the replies</button>
            <p class="hint" id="finish-note" style="margin-top:var(--s2)"></p>
          </div>
        </aside>
      </div>
      ${script.skipped.length ? html`<p class="hint" style="margin-top:var(--s5)">${script.skipped.length} tests need direct access to an endpoint (HTTPS, error handling, rate limits, metadata), so they are marked not tested: ${script.skipped.map((x) => x.probeId).join(', ')}.</p>` : ''}
    </section>`);

  function paintProgress() {
    const n = doneCount();
    $('#count', main).textContent = `${n} of ${steps.length} replies pasted`;
    $('#meter', main).style.width = `${Math.round((n / steps.length) * 100)}%`;
    const left = steps.length - n;
    const min = script.minReplies || 20;
    $('#finish', main).disabled = n < min;
    $('#finish-note', main).textContent = n < min
      ? `Loxe grades a hand test once ${min} tests have a reply, so a few passes cannot look like a clean result. ${min - n} to go.`
      : left ? `${left} without a reply will be marked not tested.` : 'Every test has a reply.';
    $('#finish', main).className = left ? 'btn' : 'btn btn--primary';
  }

  function paintList() {
    $('#list', main).innerHTML = String(html`${steps.map((st, k) => html`<li><button type="button" data-go="${k}" ${raw(k === i ? 'aria-current="step"' : '')}>${mark(state(st), { size: 's', label: false })}<span class="mono">${st.probeId}</span><span class="t">${st.title}</span></button></li>`)}`);
    $$('[data-go]', main).forEach((b) => b.addEventListener('click', () => { i = Number(b.dataset.go); paint(); }));
  }

  function paintStep() {
    const st = steps[i];
    const multi = st.messages.length > 1;
    $('#step', main).innerHTML = String(html`
      <div class="section-head"><h2 class="h3">Test ${i + 1} of ${steps.length}: ${st.title}</h2><span class="small">${CATEGORY_LABEL[st.category] || ''}</span></div>
      ${multi ? html`<p class="body" style="margin-top:var(--s2)">This test is ${st.messages.length} messages in the same chat. Send the first, paste the reply, then send the next.</p>` : ''}
      ${st.messages.map((m, k) => html`<div class="hand__turn">
        <div class="hand__msg">
          <div class="snip__head"><span class="label">${multi ? `Message ${k + 1}: send this` : 'Send this'}</span><button class="btn btn--s" type="button" data-copy="${k}">Copy</button></div>
          <pre class="raw">${m}</pre>
        </div>
        <label class="label" for="r-${k}" style="margin-top:var(--s3);display:block">${multi ? `Reply ${k + 1}: paste what it said` : 'Paste what it said'}</label>
        <textarea class="textarea" id="r-${k}" data-reply="${k}" spellcheck="false">${st.saved?.replies?.[k] || ''}</textarea>
      </div>`)}
      <div class="hand__nav">
        <button class="btn btn--primary" type="button" id="save">${i < steps.length - 1 ? 'Save and next' : 'Save'}</button>
        <button class="btn btn--quiet" type="button" id="skip">Skip this test</button>
        ${i > 0 ? html`<button class="btn btn--quiet" type="button" id="back">Back</button>` : ''}
      </div>
      ${st.saved?.skipped ? html`<p class="hint" style="margin-top:var(--s3)">${mark('off', { size: 's' })} Skipped. Paste a reply to include it.</p>` : ''}`);
    $$('[data-copy]', main).forEach((b) => b.addEventListener('click', () => {
      copy(st.messages[Number(b.dataset.copy)], 'Message copied');
      say(`Paste it into your chat with ${agent.name}, then paste its answer below.`);
    }));
    $('#save', main).addEventListener('click', () => save(false));
    $('#skip', main).addEventListener('click', () => save(true));
    $('#back', main)?.addEventListener('click', () => { i -= 1; paint(); });
    const first = $$('[data-reply]', main).find((t) => !t.value);
    if (first && i > 0) first.focus({ preventScroll: true });
  }

  async function save(skip) {
    const st = steps[i];
    const replies = $$('[data-reply]', main).map((t) => t.value);
    if (!skip && replies.some((r) => !r.trim())) {
      toast(st.messages.length > 1 ? 'Paste every reply for this test, or skip it.' : 'Paste the reply first, or skip this test.', 'gap');
      return;
    }
    const b = $(skip ? '#skip' : '#save', main);
    b.classList.add('is-busy'); b.disabled = true;
    try {
      const r = await api.saveReply(run.id, st.probeId, skip ? { skip: true } : { replies });
      st.saved = r.saved;
      const next = steps.findIndex((x, k) => k > i && !x.saved);
      if (next >= 0) i = next;
      else if (i < steps.length - 1) i += 1;
      paint();
      if (doneCount() === steps.length) say('Every test has a reply. Judge them when you are ready.');
    } catch (e) {
      toast(`Not saved: ${e.message}`, 'gap');
      b.classList.remove('is-busy'); b.disabled = false;
    }
  }

  function paint() { paintProgress(); paintList(); paintStep(); }
  paint();

  $('#finish', main).addEventListener('click', async (e) => {
    const b = e.target;
    b.classList.add('is-busy'); b.disabled = true;
    say('Judging every reply with the same rules as an automatic run, then hashing each result into the ledger.');
    try {
      await api.finishHand(run.id);
      ctx.go(`#/agents/${agent.id}/report`);
    } catch (er) {
      toast(`Could not judge: ${er.message}`, 'gap');
      b.classList.remove('is-busy'); b.disabled = false;
    }
  });
}
