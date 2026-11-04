// Shell, auth boot and hash router.
import { api, MOCK, setTokenProvider, setUnauthorizedHandler } from './api.js';
import { html, raw, $, esc, toast } from './ui.js';

const CLERK_VERSION = '6.39.0';

export const session = { provider: 'dev', user: null, org: null, clerk: null };

const ROUTES = [
  [/^$/, () => import('./screens/hub.js')],
  [/^add$/, () => import('./screens/add.js')],
  [/^integrations$/, () => import('./screens/integrations.js')],
  [/^signin$/, () => import('./screens/signin.js')],
  [/^agents\/([^/]+)$/, () => import('./screens/agent.js')],
  [/^agents\/([^/]+)\/report$/, () => import('./screens/report.js')],
  [/^agents\/([^/]+)\/ledger$/, () => import('./screens/ledger.js')],
  [/^agents\/([^/]+)\/share$/, () => import('./screens/share.js')],
  [/^agents\/([^/]+)\/monitor$/, () => import('./screens/monitor.js')],
  [/^runs\/([^/]+)$/, () => import('./screens/run.js')],
];

let cleanups = [];
let renderSeq = 0;

export function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function parseHash() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  return { path: path.replace(/\/$/, ''), query: Object.fromEntries(new URLSearchParams(qs)) };
}

function shell() {
  const app = $('#app');
  app.innerHTML = String(html`
    <a class="skip" href="#main">Skip to content</a>
    <header class="bar" role="banner">
      <div class="bar__inner">
        <a class="wordmark" href="#/" aria-label="Loxe, all agents">Loxe</a>
        <nav class="nav" aria-label="Main">
          <a href="#/" data-nav="hub">Agents</a>
          <a href="#/add" data-nav="add">Add agent</a>
          <a href="#/integrations" data-nav="integrations">Integrations</a>
        </nav>
        <div class="bar__right">
          ${MOCK ? html`<span class="mockflag" title="Every response comes from js/mock.js">Sample data</span>` : ''}
          <button class="btn btn--quiet btn--s" id="theme" type="button" aria-label="Switch colour theme"></button>
          <span class="who" id="who"></span>
          <button class="btn btn--quiet btn--s" id="signout" type="button" hidden>Sign out</button>
        </div>
      </div>
    </header>
    <main id="main" class="main" tabindex="-1"></main>
  `);
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('loxe-theme', next); } catch {}
    paintTheme();
  });
  $('#signout').addEventListener('click', async () => {
    if (session.clerk) await session.clerk.signOut();
    else await fetch('/api/dev/logout', { method: 'POST' }).catch(() => {});
    session.user = null;
    paintWho();
    go('#/signin');
  });
  paintTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintTheme);
}

function paintTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  $('#theme').textContent = cur === 'dark' ? 'Light mode' : 'Dark mode';
}

export function paintWho() {
  const who = $('#who');
  const so = $('#signout');
  if (!who) return;
  who.textContent = session.user ? `${session.org?.name ? session.org.name + ', ' : ''}${session.user.email}` : '';
  so.hidden = !session.user;
}

function paintNav(path) {
  const key = path === '' ? 'hub' : path.split('/')[0];
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === key || (key === 'agents' && a.dataset.nav === 'hub') || (key === 'runs' && a.dataset.nav === 'hub');
    a.toggleAttribute('aria-current', on);
    if (on) a.setAttribute('aria-current', 'page');
  });
}

async function route() {
  const seq = ++renderSeq;
  cleanups.forEach((fn) => { try { fn(); } catch {} });
  cleanups = [];
  const { path, query } = parseHash();
  if (!session.user && path !== 'signin') {
    go(`#/signin?next=${encodeURIComponent(location.hash || '#/')}`);
    return;
  }
  const hit = ROUTES.find(([re]) => re.test(path));
  const main = $('#main');
  paintNav(path);
  if (!hit) {
    main.innerHTML = String(html`<section class="page"><h1 class="h1">This page does not exist.</h1><p class="lede">The link may be from an older version of Loxe.</p><a class="btn btn--primary" href="#/">Back to all agents</a></section>`);
    return;
  }
  const params = path.match(hit[0]).slice(1);
  let mod;
  try { mod = await hit[1](); } catch (err) {
    main.innerHTML = String(html`<section class="page"><div class="state state--error" role="alert"><div class="state__head"><span class="mark mark--fail" aria-hidden="true"></span><h2 class="h2">This screen did not load.</h2></div><p class="body">The browser could not load its code: ${err.message}. Reload the page to fetch it again.</p><div class="row"><button class="btn" onclick="location.reload()">Reload</button></div></div></section>`);
    return;
  }
  if (seq !== renderSeq) return;
  main.classList.remove('is-entering');
  main.setAttribute('aria-busy', 'true');
  const ctx = {
    params, query, session, go,
    onLeave: (fn) => cleanups.push(fn),
    alive: () => seq === renderSeq,
  };
  const settle = () => { main.removeAttribute('aria-busy'); main.classList.remove('is-entering'); void main.offsetWidth; main.classList.add('is-entering'); };
  // Screens that paint a skeleton first call this early through the MutationObserver below.
  const mo = new MutationObserver(() => { mo.disconnect(); if (seq === renderSeq) settle(); });
  mo.observe(main, { childList: true });
  try {
    await mod.render(main, ctx);
    mo.disconnect();
    if (seq === renderSeq && main.hasAttribute('aria-busy')) settle();
  } catch (err) {
    mo.disconnect();
    if (seq === renderSeq) main.removeAttribute('aria-busy');
    if (seq !== renderSeq) return;
    if (err?.status === 401) return;
    const { errorBlock } = await import('./ui.js');
    main.innerHTML = String(err?.status === 404
      ? html`<section class="page"><div class="state"><div class="state__head"><span class="mark mark--off" aria-hidden="true"></span><h2 class="h2">Loxe has no record of this.</h2></div><p class="body">The agent or run was archived, or the link is from another organisation. Ledger entries are never deleted, so anything it proved is still verifiable.</p><div class="row"><a class="btn btn--primary" href="#/">Back to all agents</a></div></div></section>`
      : html`<section class="page">${errorBlock(err)}</section>`);
    main.querySelector('[data-action="retry"]')?.addEventListener('click', route);
  }
  const auto = main.querySelector('[data-autofocus]');
  if (auto && ctx.alive()) auto.focus({ preventScroll: true });
}

function loadScript(src, attrs = {}) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    Object.entries(attrs).forEach(([k, v]) => s.setAttribute(k, v));
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Could not load ${src}`));
    document.head.append(s);
  });
}

async function bootAuth() {
  const cfg = await api.config();
  session.provider = cfg?.auth?.provider || 'dev';
  if (session.provider === 'clerk') {
    if (!cfg.auth.publishableKey) throw new Error('The server says auth is Clerk but sent no publishable key. Add the Clerk publishable key to the Loxe server config.');
    await loadScript(`https://cdn.jsdelivr.net/npm/@clerk/clerk-js@${CLERK_VERSION}/dist/clerk.browser.js`, { 'data-clerk-publishable-key': cfg.auth.publishableKey });
    const clerk = window.Clerk;
    await clerk.load();
    session.clerk = clerk;
    setTokenProvider(async () => (clerk.session ? clerk.session.getToken() : null));
    clerk.addListener?.(({ user }) => {
      if (user && !session.user) { loadMe().then(() => go(parseHash().query.next || '#/')); }
    });
  }
  await loadMe();
}

export async function loadMe() {
  try {
    const me = await api.me();
    session.user = me.user;
    session.org = me.org;
  } catch (e) {
    if (e.status !== 401) throw e;
    session.user = null;
  }
  paintWho();
}

async function boot() {
  try {
    const t = localStorage.getItem('loxe-theme');
    if (t) document.documentElement.dataset.theme = t;
  } catch {}
  shell();
  const main = $('#main');
  main.innerHTML = String(html`<section class="page"><p class="lede boot">Checking who you are with the Loxe server.</p></section>`);
  setUnauthorizedHandler(() => {
    if (!session.user) return;
    session.user = null;
    paintWho();
    toast('Your session ended. Sign in again to continue.', 'gap');
    go(`#/signin?next=${encodeURIComponent(location.hash || '#/')}`);
  });
  try {
    await bootAuth();
  } catch (err) {
    main.innerHTML = String(html`<section class="page"><div class="state state--error" role="alert"><div class="state__head"><span class="mark mark--fail" aria-hidden="true"></span><h2 class="h2">Loxe could not start.</h2></div><p class="body">${err.message}</p><p class="body">The app asks <code class="mono">/api/config</code> how sign-in works before anything else. Check that the Loxe server is running at this address. To preview the UI with sample data, add <code class="mono">?mock=1</code> to the URL.</p><button class="btn" id="reboot">Try again</button></div></section>`);
    $('#reboot').onclick = () => location.reload();
    return;
  }
  window.addEventListener('hashchange', route);
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.target.closest('input, textarea, select')) return;
    const { path } = parseHash();
    if (path && path !== 'signin') { e.preventDefault(); go('#/'); }
  });
  route();
}

boot();
