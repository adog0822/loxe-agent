// INTEGRATION CALLER — sponsor calls must never break a clearance run or a page load.
// integration('supermemory', 'rememberRun', args) loads the module lazily, calls the function,
// and returns null on any error (logged without secrets).
const modules = {
  maritime: () => import('./maritime.js'),
  keiki: () => import('./keiki.js'),
  supermemory: () => import('./supermemory.js'),
  slack: () => import('./slack.js'),
};
const SERVER_WIDE = ['maritime', 'keiki', 'supermemory'];

export async function integration(name, fn, ...args) {
  try {
    const mod = await modules[name]();
    if (typeof mod[fn] !== 'function') return null;
    return await mod[fn](...args);
  } catch (err) {
    console.warn(`[${name}.${fn}] ${err.message}`);
    return null;
  }
}

export async function integrationStatus() {
  const out = {};
  for (const name of SERVER_WIDE) {
    out[name] = (await integration(name, 'status')) || {
      configured: false, ok: null, detail: `${name} module unavailable`, checkedAt: new Date().toISOString(),
    };
  }
  return out;
}
