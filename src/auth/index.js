// AUTH — who is calling, and which org they act for.
// 1. Org API keys: `Authorization: Bearer lx_…` (Keiki tools, CI, scripts). Stored as sha256.
// 2. Clerk: session JWT from the __session cookie or a Bearer header, verified with
//    CLERK_SECRET_KEY. A Clerk organization (org_id claim) maps to a Loxe org; otherwise each
//    user gets a personal org.
// 3. Dev auth: only when CLERK_SECRET_KEY is unset and NODE_ENV !== 'production'.
//    POST /api/dev/login {email} sets an HMAC-signed cookie. Never enabled in production.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { sha256 } from '../core/canonical.js';

const DEV_COOKIE = 'loxe_dev';
const userCache = new Map();

export function authProvider() {
  if (process.env.CLERK_SECRET_KEY) return 'clerk';
  if (process.env.NODE_ENV === 'production') return 'none';
  return 'dev';
}

export function createAuth(db) {
  let devSecret;
  const secret = async () => {
    if (devSecret) return devSecret;
    if (process.env.LOXE_SESSION_SECRET) return (devSecret = process.env.LOXE_SESSION_SECRET);
    const row = (await db.query(`select value from settings where key = 'dev_session_secret'`)).rows[0];
    if (row) return (devSecret = (typeof row.value === 'string' ? JSON.parse(row.value) : row.value).secret);
    const s = randomBytes(32).toString('hex');
    await db.query(`insert into settings (key, value) values ('dev_session_secret', $1) on conflict (key) do nothing`, [
      JSON.stringify({ secret: s }),
    ]);
    return (devSecret = s);
  };

  async function ensureUser({ userId, email, name, orgId, orgName }) {
    await db.query(`insert into orgs (id, name) values ($1, $2) on conflict (id) do nothing`, [orgId, orgName]);
    await db.query(
      `insert into users (id, email, name, org_id) values ($1, $2, $3, $4)
       on conflict (id) do update set email = excluded.email, name = excluded.name, org_id = excluded.org_id`,
      [userId, email, name || null, orgId]
    );
    const org = (await db.query(`select id, name from orgs where id = $1`, [orgId])).rows[0];
    return { user: { id: userId, email, name: name || email }, org };
  }

  async function fromApiKey(token) {
    const row = (await db.query(
      `select k.id, k.org_id, o.name from api_keys k join orgs o on o.id = k.org_id
       where k.key_hash = $1 and k.revoked_at is null`,
      [sha256(token)]
    )).rows[0];
    if (!row) return null;
    await db.query(`update api_keys set last_used_at = now() where id = $1`, [row.id]);
    return { user: { id: `key:${row.id}`, email: null, name: 'API key' }, org: { id: row.org_id, name: row.name }, via: 'api_key' };
  }

  async function fromClerk(token) {
    const { verifyToken, createClerkClient } = await import('@clerk/backend');
    let claims;
    try {
      // Only tokens minted for this app's own origin are accepted.
      const parties = (process.env.LOXE_BASE_URL ? [new URL(process.env.LOXE_BASE_URL).origin] : []);
      claims = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY, ...(parties.length ? { authorizedParties: parties } : {}) });
    } catch {
      return null;
    }
    // Profile lookups are cached for 5 minutes: runs poll every second and Clerk rate-limits.
    let u = userCache.get(claims.sub);
    if (!u || u.exp < Date.now()) {
      const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
      u = { user: await clerk.users.getUser(claims.sub), exp: Date.now() + 5 * 60_000 };
      userCache.set(claims.sub, u);
      if (userCache.size > 5000) userCache.delete(userCache.keys().next().value);
    }
    u = u.user;
    const email = u.primaryEmailAddress?.emailAddress || u.emailAddresses?.[0]?.emailAddress || claims.sub;
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || email;
    // Session token v2 nests the active org under `o` ({ id, slg, rol }); v1 used org_id/org_slug.
    const clerkOrg = claims.o?.id || claims.org_id;
    const orgId = clerkOrg ? `clerk:${clerkOrg}` : `personal:${claims.sub}`;
    const orgName = claims.o?.slg || claims.org_slug || `${name}'s org`;
    return { ...(await ensureUser({ userId: claims.sub, email, name, orgId, orgName })), via: 'clerk' };
  }

  async function fromDevCookie(c) {
    const raw = getCookie(c, DEV_COOKIE);
    if (!raw) return null;
    const [b64, mac] = raw.split('.');
    const expected = createHmac('sha256', await secret()).update(b64).digest('base64url');
    if (!mac || mac.length !== expected.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
    const { email } = JSON.parse(Buffer.from(b64, 'base64url').toString());
    const userId = `dev-${sha256(email).slice(0, 12)}`;
    const domain = email.split('@')[1] || 'local';
    return { ...(await ensureUser({ userId, email, name: email.split('@')[0], orgId: `dev:${domain}`, orgName: domain })), via: 'dev' };
  }

  // Resolve the caller for this request, or null.
  async function identify(c) {
    const header = c.req.header('authorization') || '';
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    if (bearer?.startsWith('lx_')) return fromApiKey(bearer);
    const provider = authProvider();
    if (provider === 'clerk') {
      const token = bearer || getCookie(c, '__session');
      return token ? fromClerk(token) : null;
    }
    if (provider === 'dev') return fromDevCookie(c);
    return null;
  }

  // Hono middleware: 401 unless identified; sets c.var.auth.
  const requireAuth = async (c, next) => {
    const usesCookie = !(c.req.header('authorization') || '').startsWith('Bearer ');
    if (usesCookie && !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      const self = new URL(c.req.url).origin;
      const allowed = [self, process.env.LOXE_BASE_URL && new URL(process.env.LOXE_BASE_URL).origin].filter(Boolean);
      if (!origin || !allowed.includes(origin)) return c.json({ error: 'cross-site request refused' }, 403);
    }
    const who = await identify(c);
    if (!who) return c.json({ error: 'sign in required' }, 401);
    c.set('auth', who);
    await next();
  };

  async function devLogin(c, email) {
    const b64 = Buffer.from(JSON.stringify({ email, at: Date.now() })).toString('base64url');
    const mac = createHmac('sha256', await secret()).update(b64).digest('base64url');
    setCookie(c, DEV_COOKIE, `${b64}.${mac}`, { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 7 });
  }

  const devLogout = (c) => deleteCookie(c, DEV_COOKIE, { path: '/' });

  // Create an org API key. Returns the full key once; only its hash is stored.
  async function createApiKey(orgId, name, createdBy) {
    const key = `lx_${randomBytes(24).toString('base64url')}`;
    const keyId = `key-${randomBytes(6).toString('hex')}`;
    await db.query(
      `insert into api_keys (id, org_id, name, key_hash, prefix, created_by) values ($1, $2, $3, $4, $5, $6)`,
      [keyId, orgId, name, sha256(key), key.slice(0, 7), createdBy]
    );
    return { id: keyId, name, key, prefix: key.slice(0, 7) };
  }

  return { identify, requireAuth, devLogin, devLogout, createApiKey };
}
