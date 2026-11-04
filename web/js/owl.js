// The owl: a persistent guide. One button in the corner opens a side panel where you can ask
// anything (POST /api/owl), pick a question written for the current screen, or follow the demo tour.
// say() is the owl's one-line narration of whatever the app is doing right now.
import { api } from './api.js';
import { html, raw, $, $$, esc } from './ui.js';

const OWL_SRC = 'assets/owl.png';
const state = { open: false, context: { route: '' }, log: [], tour: null, busy: false, quick: [] };
let sayTimer;

export const owlImg = (size = 28, alt = '') => html`<img class="owl" src="${OWL_SRC}" width="${size}" height="${size}" alt="${alt}">`;

export function mountOwl() {
  if ($('#owl-btn')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = String(html`
    <div class="owlsay" id="owl-say" role="status" aria-live="polite"></div>
    <button class="owlbtn" id="owl-btn" type="button" aria-expanded="false" aria-controls="owl-panel" aria-label="Ask the owl a question">${owlImg(40)}<span class="owlbtn__q" aria-hidden="true">?</span></button>
    <aside class="owlpanel" id="owl-panel" aria-label="The owl guide" hidden>
      <div class="owlpanel__head">
        ${owlImg(32)}
        <div><div class="h3">Ask the owl</div><div class="small" id="owl-where">It reads the screen you are on.</div></div>
        <button class="btn btn--quiet btn--s" id="owl-close" type="button">Close</button>
      </div>
      <div class="owlpanel__body" id="owl-body"></div>
      <form class="owlpanel__ask" id="owl-ask">
        <label class="sr" for="owl-q">Your question</label>
        <textarea class="textarea" id="owl-q" rows="2" placeholder="Ask anything about this screen"></textarea>
        <button class="btn btn--primary" type="submit">Ask</button>
      </form>
    </aside>`);
  document.body.append(...wrap.children);
  $('#owl-btn').addEventListener('click', () => toggle());
  $('#owl-close').addEventListener('click', () => toggle(false));
  $('#owl-ask').addEventListener('submit', (e) => { e.preventDefault(); const q = $('#owl-q').value.trim(); if (q) ask(q); });
  $('#owl-q').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#owl-ask').requestSubmit(); } });
  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === '?') { e.preventDefault(); toggle(true); $('#owl-q')?.focus(); }
    if (e.key === 'Escape' && state.open && !state.tour) { toggle(false); e.stopPropagation(); }
  }, true);
}

export function toggle(force) {
  state.open = force ?? !state.open;
  const p = $('#owl-panel');
  p.hidden = !state.open;
  document.body.classList.toggle('owl-open', state.open);
  $('#owl-btn').setAttribute('aria-expanded', String(state.open));
  if (state.open) paint();
}

// Screens call this with what is on screen, so questions are grounded in it.
export function setContext(ctx, quick = []) {
  state.context = { ...ctx };
  state.quick = quick;
  if (state.open) paint();
}

// One short line about what is happening. Stays until the next line or 7 seconds.
export function say(text, { sticky = false } = {}) {
  const el = $('#owl-say');
  if (!el) return;
  el.textContent = text;
  el.classList.toggle('is-on', !!text);
  clearTimeout(sayTimer);
  if (!sticky && text) sayTimer = setTimeout(() => el.classList.remove('is-on'), 7000);
}

export function setTour(tour) {
  state.tour = tour;
  state.log = []; // the demo and the real workspace never share a conversation
  document.body.classList.toggle('in-tour', !!tour);
  if (tour) toggle(true);
  else if (state.open) paint();
}
export const repaint = () => state.open && paint();

async function ask(question) {
  if (state.busy) return;
  state.busy = true;
  state.log.push({ q: question, a: null });
  $('#owl-q').value = '';
  paint();
  say('Reading this screen and the Loxe docs to answer.');
  try {
    const r = await api.owl(question, state.context);
    state.log.at(-1).a = String(r?.answer ?? '').trim() || 'The guide returned an empty answer.';
    say('');
  } catch (e) {
    state.log.at(-1).a = e.status === 503
      ? 'The guide is unavailable right now. Nothing else is affected: the report, the ledger and every action still work. Try again in a minute.'
      : e.status === 401 ? 'Your session ended. Sign in again and ask once more.'
      : `The guide could not answer: ${e.message}`;
    state.log.at(-1).error = true;
    say('');
  }
  state.busy = false;
  paint();
}

function paint() {
  const body = $('#owl-body');
  if (!body) return;
  $('#owl-where').textContent = state.tour ? 'Guiding you through the demo.' : 'It reads the screen you are on.';
  const tourHtml = state.tour ? state.tour.render() : '';
  body.innerHTML = String(html`
    ${tourHtml ? html`<div class="tourcard" id="owl-tour">${raw(String(tourHtml))}</div>` : ''}
    ${state.log.length ? html`<ol class="owllog" aria-live="polite">${state.log.map((m) => html`<li><p class="owllog__q">${m.q}</p>${m.a === null ? html`<p class="owllog__a is-wait">Thinking it through.</p>` : html`<p class="owllog__a ${m.error ? 't-gap' : ''}">${m.a}</p>`}</li>`)}</ol>` : ''}
    ${state.quick.length ? html`<div class="owlquick"><div class="label">Questions people ask here</div>${state.quick.map((q) => html`<button type="button" class="owlquick__q" data-q="${q}">${q}</button>`)}</div>` : ''}`);
  $$('[data-q]', body).forEach((b) => b.addEventListener('click', () => ask(b.dataset.q)));
  if (state.tour) state.tour.bind?.($('#owl-tour'));
  const log = body.querySelector('.owllog li:last-child');
  if (log) log.scrollIntoView({ block: 'nearest' });
}
