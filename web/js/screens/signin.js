// Sign in. Clerk mounts its own form; dev auth posts an email to /api/dev/login.
import { api } from '../api.js';
import { html, $, h1, mark } from '../ui.js';
import { loadMe, session } from '../app.js';

export async function render(main, ctx) {
  const next = ctx.query.next && ctx.query.next.startsWith('#/') && !ctx.query.next.startsWith('#/signin') ? ctx.query.next : '#/';
  if (session.user) { ctx.go(next); return; }

  if (session.provider === 'clerk' && session.clerk) {
    main.innerHTML = String(html`<section class="page signin">${h1('Sign in to Loxe.')}<p class="lede">Your agents, their runs and the ledger are scoped to your organisation.</p><div id="clerk" style="margin-top:var(--s5)"></div></section>`);
    session.clerk.mountSignIn($('#clerk', main), { afterSignInUrl: location.pathname + location.search + next, signUpUrl: undefined });
    ctx.onLeave(() => { try { session.clerk.unmountSignIn($('#clerk')); } catch {} });
    return;
  }

  main.innerHTML = String(html`
    <section class="page signin">
      ${h1('Sign in to Loxe.')}
      <p class="lede">This server runs development sign-in. Enter an email and you are in; your agents are kept under that address's organisation.</p>
      <form id="dev" novalidate>
        <div class="field">
          <label class="label" for="email">Work email</label>
          <input class="input" id="email" name="email" type="email" autocomplete="email" inputmode="email" required data-autofocus placeholder="you@company.com">
          <span class="field__error" id="err" hidden></span>
        </div>
        <button class="btn btn--primary" type="submit" style="margin-top:var(--s4)">Sign in</button>
        <p class="hint" style="margin-top:var(--s4)">No password. Set CLERK_SECRET_KEY on the server for real accounts.</p>
      </form>
    </section>`);
  const form = $('#dev', main);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const err = $('#err', form);
    err.hidden = true;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      err.textContent = 'Enter an email address like you@company.com.';
      err.hidden = false;
      form.email.setAttribute('aria-invalid', 'true');
      return;
    }
    const b = form.querySelector('button');
    b.classList.add('is-busy'); b.disabled = true;
    try {
      await api.devLogin(email);
      await loadMe();
      ctx.go(next);
    } catch (ex) {
      err.textContent = ex.status === 404 ? 'Dev sign-in is off on this server. It only runs when Clerk is not configured and NODE_ENV is not production.' : `Sign-in failed: ${ex.message}`;
      err.hidden = false;
      b.classList.remove('is-busy'); b.disabled = false;
    }
  });
}
