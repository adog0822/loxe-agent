// Shell, auth boot and hash router.
import { api, MOCK, isDemo, setDemo, setTokenProvider, setUnauthorizedHandler } from './api.js';
import { html, raw, $, $$, esc, toast } from './ui.js';
import { mountOwl, owlImg, setContext, say, toggle as toggleOwl } from './owl.js';
import { getPrefs } from './prefs.js';

const CLERK_VERSION = '6.39.0';
const CLERK_UI_VERSION = '1.42.3'; // clerk-js v6 ships its sign-in UI as a separate bundle

export const session = { provider: 'dev', user: null, org: null, clerk: null, realUser: null, realOrg: null };

const ROUTES = [
  [/^$/, () => import('./screens/hub.js')],
  [/^add$/, () => import('./screens/add.js')],
  [/^integrations$/, () => import('./screens/integrations.js')],
  [/^connect$/, () => import('./screens/connect.js')],
  [/^welcome$/, () => import('./screens/welcome.js')],
  [/^why$/, () => import('./screens/why.js')],
  [/^security$/, () => import('./screens/security.js')],
  [/^signin$/, () => import('./screens/signin.js')],
  [/^agents\/([^/]+)$/, () => import('./screens/agent.js')],
  [/^agents\/([^/]+)\/report$/, () => import('./screens/report.js')],
  [/^agents\/([^/]+)\/ledger$/, () => import('./screens/ledger.js')],
  [/^agents\/([^/]+)\/share$/, () => import('./screens/share.js')],
  [/^agents\/([^/]+)\/monitor$/, () => import('./screens/monitor.js')],
  [/^runs\/([^/]+)$/, () => import('./screens/run.js')],
];

// Questions the owl offers on each screen, before a screen adds its own.
const QUICK = {
  hub: ['What should I do first?', 'How is this list ranked?', 'What does a grade mean?'],
  add: ['What does Loxe send to my endpoint?', 'Are my auth headers stored?'],
  connect: ['Which way should I connect my agent?', 'How do I fail a build below a grade?'],
  runs: ['Why is no model deciding pass or fail?', 'What happens if the agent goes down mid-run?'],
  report: ['What does this grade mean?', 'Is this a certification?'],
  ledger: ['What is SHA-256 doing here?', 'What happens if someone edits an entry?', 'How can a buyer check this without me?'],
  share: ['What does the public page claim?', 'Is this a certification?'],
  monitor: ['How does sentinel work?', 'Where do alerts go?'],
  integrations: ['What does each integration add?'],
  welcome: ['Why do you ask these questions?'],
};

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
    <div class="demoband" id="demoband" hidden>
      <div class="demoband__inner"><span><b>Demo workspace.</b> Sample agents and sample data. Your real agents are untouched.</span><button class="btn btn--s" type="button" data-demo="off">Leave demo</button></div>
    </div>
    <header class="bar" role="banner">
      <div class="bar__inner">
        <a class="brand" href="#/" aria-label="Loxe, all agents">${owlImg(28)}<span>Loxe</span></a>
        <nav class="nav" aria-label="Main">
          <a href="#/" data-nav="hub">Agents</a>
          <a href="#/add" data-nav="add">Add agent</a>
          <a href="#/connect" data-nav="connect">Connect</a>
        </nav>
        <span class="navquiets"><a class="navquiet" href="#/why" data-nav="why">What is Loxe</a><a class="navquiet" href="#/security" data-nav="security">Security</a></span>
        <div class="bar__right">
          <label class="demotoggle" title="Switch to a guided demo with sample data"><input type="checkbox" id="demo-switch"> <span>Demo</span></label>
          <div class="menu" id="usermenu">
            <button class="menu__btn" id="menu-btn" type="button" aria-haspopup="true" aria-expanded="false" aria-controls="menu-list"><span class="avatar" id="avatar" aria-hidden="true"></span><span class="sr">Account menu</span><span class="chev chev--s" aria-hidden="true"></span></button>
            <div class="menu__list" id="menu-list" role="menu" hidden>
              <div class="menu__who" id="who"></div>
              <a role="menuitem" href="#/why">What is Loxe</a>
              <a role="menuitem" href="#/security">Security and data</a>
              <a role="menuitem" href="#/integrations">Integrations and settings</a>
              <a role="menuitem" href="#/connect">API keys and CLI</a>
              <button role="menuitem" type="button" id="theme"></button>
              <button role="menuitem" type="button" id="restart-tour" hidden>Show the welcome questions again</button>
              <button role="menuitem" type="button" id="signout">Sign out</button>
            </div>
          </div>
        </div>
      </div>
    </header>
    <main id="main" class="main" tabindex="-1"></main>
  `);
  const menuBtn = $('#menu-btn');
  const list = $('#menu-list');
  const setMenu = (open) => { list.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menuBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(list.hidden); });
  document.addEventListener('click', (e) => { if (!e.target.closest('#usermenu')) setMenu(false); });
  list.addEventListener('click', (e) => { if (e.target.closest('a, button')) setMenu(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !list.hidden) { setMenu(false); menuBtn.focus(); } });
  $('#theme').addEventListener('click', () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('loxe-theme', next); } catch {}
    paintTheme();
  });
  $('#restart-tour').addEventListener('click', () => go('#/welcome?again=1'));
  $('#signout').addEventListener('click', signOut);
  $('#demo-switch').addEventListener('change', (e) => (e.target.checked ? enterDemo() : leaveDemo()));
  $$('[data-demo="off"]').forEach((b) => b.addEventListener('click', () => leaveDemo()));
  paintTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', paintTheme);
  mountOwl();
}

async function signOut() {
  if (isDemo()) await leaveDemo({ quiet: true });
  if (session.clerk) await session.clerk.signOut();
  else await api.devLogout().catch(() => {});
  session.user = null;
  paintWho();
  go('#/signin');
}

// The demo swaps the API layer for the in-page fixtures. The real session is parked, not touched.
export async function enterDemo({ tour = true } = {}) {
  if (!isDemo()) { session.realUser = session.user; session.realOrg = session.org; }
  await setDemo(true);
  const me = await api.me();
  session.user = me.user; session.org = me.org;
  paintWho();
  if (!tour) return;
  const { startTour } = await import('./tour.js');
  startTour({ go, leave: leaveDemo });
}

// Straight to a sample agent's ledger trace in the demo, verifying on arrival.
export async function openDemoLedger() {
  await enterDemo({ tour: false });
  const agents = await api.agents();
  const a = agents.find((x) => x.chain?.length) || agents[0];
  say('Demo workspace. This ledger belongs to a sample agent; your browser is about to recompute it.');
  go(`#/agents/${a.id}/ledger?auto=1`);
}

export async function leaveDemo({ quiet = false, firstAgent = false } = {}) {
  const { stopTour } = await import('./tour.js');
  stopTour();
  await setDemo(false);
  session.user = session.realUser; session.org = session.realOrg;
  if (!session.user) await loadMe().catch(() => {});
  paintWho();
  if (!quiet) { toggleOwl(false); say('Back in your workspace. Nothing in it changed.'); go(firstAgent ? '#/?first=1' : '#/'); }
}

function paintTheme() {
  const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  $('#theme').textContent = cur === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
}

export function paintWho() {
  const who = $('#who');
  if (!who) return;
  const u = session.user;
  who.innerHTML = String(u ? html`<b>${u.name || u.email}</b><span>${u.email}</span>${session.org?.name ? html`<span>${session.org.name}</span>` : ''}` : html`<span>Not signed in</span>`);
  $('#avatar').textContent = u ? (u.name || u.email || '?').trim().slice(0, 1).toUpperCase() : '';
  $('#usermenu').hidden = !u;
  $('#restart-tour').hidden = !u || isDemo();
  const demo = isDemo();
  document.body.classList.toggle('is-demo', demo);
  $('#demoband').hidden = !demo;
  $('#demo-switch').checked = demo;
  $('#demo-switch').closest('.demotoggle').hidden = MOCK || !u;
  $('.nav').hidden = !u;
  $('#demoband button').hidden = MOCK;
}

function paintNav(path) {
  const key = path === '' ? 'hub' : path.split('/')[0];
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === key || ((key === 'agents' || key === 'runs') && a.dataset.nav === 'hub');
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

async function route() {
  const seq = ++renderSeq;
  cleanups.forEach((fn) => { try { fn(); } catch {} });
  cleanups = [];
  const { path, query } = parseHash();
  if (!session.user && !['signin', 'why', 'security'].includes(path)) {
    if (isDemo()) { await enterDemo(); return; }
    go(`#/signin?next=${encodeURIComponent(location.hash || '#/')}`);
    return;
  }
  // First sign-in: the owl asks three questions before anything else.
  if (session.user && !isDemo() && !['welcome', 'signin', 'why', 'security'].includes(path) && !getPrefs(session.user.id)) {
    go('#/welcome');
    return;
  }
  const hit = ROUTES.find(([re]) => re.test(path));
  const main = $('#main');
  paintNav(path);
  setContext({ route: path || 'hub' }, QUICK[path.split('/')[0] === 'agents' ? path.split('/')[2] || 'report' : path.split('/')[0] || 'hub'] || []);
  if (!hit) {
    main.innerHTML = String(html`<section class="page"><h1 class="h1">This page does not exist.</h1><p class="lede">The link may be from an older version of Loxe.</p><a class="btn btn--primary" href="#/">Back to all agents</a></section>`);
    return;
  }
  const params = path.match(hit[0]).slice(1);
  let mod;
  try { mod = await hit[1](); } catch (err) {
    setTimeout(() => main.querySelector('[data-reload]')?.addEventListener('click', () => location.reload()));
    main.innerHTML = String(html`<section class="page"><div class="state state--error" role="alert"><div class="state__head"><span class="mark mark--fail" aria-hidden="true"></span><h2 class="h2">This screen did not load.</h2></div><p class="body">The browser could not load its code: ${err.message}. Reload the page to fetch it again.</p><div class="row"><button class="btn" data-reload>Reload</button></div></div></section>`);
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
    await loadScript(`https://cdn.jsdelivr.net/npm/@clerk/ui@${CLERK_UI_VERSION}/dist/ui.browser.js`);
    const clerk = window.Clerk;
    await clerk.load({ ui: { ClerkUI: window.__internal_ClerkUICtor } });
    session.clerk = clerk;
    setTokenProvider(async () => (clerk.session ? clerk.session.getToken() : null));
    clerk.addListener?.(({ user }) => {
      // Only a sign-in that happens on the sign-in screen moves you; a reload stays where it is.
      if (user && !session.user && parseHash().path === 'signin') { loadMe().then(() => go(parseHash().query.next || '#/')); }
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
  // A reload inside the demo: boot the real session first, then re-enter the demo from the top.
  const resumeDemo = isDemo() && !MOCK;
  if (resumeDemo) await setDemo(false);
  try {
    await bootAuth();
    if (resumeDemo) await enterDemo();
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
