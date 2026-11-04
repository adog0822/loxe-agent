// First sign-in. The owl asks three questions, then offers one move: test your first agent.
import { api } from '../api.js';
import { html, raw, $, $$, toast, h1 } from '../ui.js';
import { owlImg, say } from '../owl.js';
import { WHERE, FRAMEWORKS, ALERTS, getPrefs, setPrefs } from '../prefs.js';
import { firstAgentForm, bindFirstAgent } from './first-agent.js';

export async function render(main, ctx) {
  const uid = ctx.session.user?.id;
  const prev = getPrefs(uid) || {};
  const a = { where: prev.where || null, frameworks: prev.frameworks || [], alerts: prev.alerts || null };
  let step = 0;
  const name = (ctx.session.user?.name || '').split(' ')[0];

  const QUESTIONS = [
    {
      ask: `${name ? `Hi ${name}. ` : 'Hi. '}I am the Loxe owl. Three quick questions and I will set things up around your answers.`,
      askMore: true,
      q: 'Where does your agent live?',
      hint: 'Pick the closest. You can connect from anywhere later.',
      body: () => html`<div class="choices" role="radiogroup" aria-label="Where your agent lives">${WHERE.map(([k, l, d]) => choice('where', k, l, d, a.where === k, 'radio'))}</div>`,
      ok: () => !!a.where,
    },
    {
      ask: 'Which frameworks do your buyers ask about?',
      q: 'Which frameworks matter to you?',
      hint: 'Pick any. I will list these first in every report. All four are always mapped.',
      body: () => html`<div class="choices choices--2" role="group" aria-label="Frameworks">${FRAMEWORKS.map(([k, l]) => choice('fw', k, l, '', a.frameworks.includes(k), 'checkbox'))}</div>`,
      ok: () => true,
    },
    {
      ask: 'Last one. When a grade drops, how should I tell you?',
      q: 'How do you want alerts?',
      hint: 'Alerts go through Keiki. You can change this on any agent.',
      body: () => html`<div class="choices choices--2" role="radiogroup" aria-label="Alerts">${ALERTS.map(([k, l]) => choice('alerts', k, l, '', a.alerts === k, 'radio'))}</div>`,
      ok: () => !!a.alerts,
    },
  ];

  function paint() {
    if (step >= QUESTIONS.length) return paintFirst();
    const Q = QUESTIONS[step];
    main.innerHTML = String(html`
      <section class="page welcome">
        <div class="speech">${owlImg(56, 'The Loxe owl')}<p class="speech__line">${Q.ask}${Q.askMore ? html` New here? <a class="link" href="#/why">See what Loxe is</a> first.` : ''}</p></div>
        <div>
          <div class="small">Question ${step + 1} of ${QUESTIONS.length}</div>
          <h1 class="h2" style="margin-top:var(--s2)">${Q.q}</h1>
          <p class="body">${Q.hint}</p>
        </div>
        ${Q.body()}
        <div class="row row--l">
          <button class="btn btn--primary" id="next" type="button" ${raw(Q.ok() ? '' : 'disabled')} data-autofocus>${step === QUESTIONS.length - 1 ? 'Finish' : 'Next'}</button>
          ${step > 0 ? html`<button class="btn btn--quiet" id="back" type="button">Back</button>` : ''}
          <button class="btn btn--quiet" id="skip" type="button" style="margin-left:auto">Skip the questions</button>
        </div>
      </section>`);
    $$('input[name="where"], input[name="alerts"]', main).forEach((i) => i.addEventListener('change', () => { a[i.name] = i.value; $('#next', main).disabled = false; }));
    $$('input[name="fw"]', main).forEach((i) => i.addEventListener('change', () => {
      a.frameworks = $$('input[name="fw"]:checked', main).map((x) => x.value);
    }));
    $('#next', main).addEventListener('click', () => { step++; paint(); });
    $('#back', main)?.addEventListener('click', () => { step--; paint(); });
    $('#skip', main).addEventListener('click', () => { step = QUESTIONS.length; paint(); });
    ($('input:checked', main) || $('input', main))?.focus({ preventScroll: true });
  }

  function paintFirst() {
    setPrefs(uid, a);
    say('Saved. Your hub and the Connect page are ordered around these answers.');
    if (ctx.query.again === '1') { toast('Answers updated.'); ctx.go('#/'); return; }
    main.innerHTML = String(html`
      <section class="page welcome">
        <div class="speech">${owlImg(56, 'The Loxe owl')}<p class="speech__line">Done. Now the part that matters: test your first agent. It takes about a minute.</p></div>
        ${firstAgentForm(a)}
        <p class="hint">Rather look around first? <a class="link" href="#/">Go to your workspace</a> or switch on <b>Demo</b> in the top bar for a guided tour with sample data.</p>
      </section>`);
    bindFirstAgent(main, ctx);
  }

  paint();
}

function choice(name, value, label, desc, checked, type) {
  return html`<label class="choice"><input type="${type}" name="${name}" value="${value}" ${raw(checked ? 'checked' : '')}><span class="choice__box" aria-hidden="true"></span><span><b>${label}</b>${desc ? html`<span class="choice__d">${desc}</span>` : ''}</span></label>`;
}
