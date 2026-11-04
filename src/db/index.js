// DATABASE — one interface over two engines.
// DATABASE_URL set  → node-postgres pool (Supabase in production).
// DATABASE_URL unset → embedded PGlite (real Postgres in WASM) under .data/, for local dev and tests.
// Both expose query(sql, params) → { rows } and tx(fn) for transactions.
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function createDb({ url = process.env.DATABASE_URL, dataDir } = {}) {
  const db = url ? await pgDb(url) : await pgliteDb(dataDir ?? process.env.LOXE_PGLITE_DIR ?? '.data/pglite');
  await migrate(db);
  return db;
}

async function pgDb(url) {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    engine: 'postgres',
    query: (sql, params) => pool.query(sql, params),
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn({ query: (s, p) => client.query(s, p) });
        await client.query('COMMIT');
        return out;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

async function pgliteDb(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  // dataDir ':memory:' keeps everything in RAM (tests)
  if (dataDir !== ':memory:') mkdirSync(dataDir, { recursive: true });
  const lite = dataDir === ':memory:' ? new PGlite() : new PGlite(dataDir);
  await lite.waitReady;
  // PGlite is single-connection: serialize top-level work so transactions never interleave
  let chain = Promise.resolve();
  const serial = (fn) => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => {});
    return next;
  };
  return {
    engine: 'pglite',
    query: (sql, params) => serial(() => lite.query(sql, params)),
    tx: (fn) => serial(() => lite.transaction((t) => fn({ query: (s, p) => t.query(s, p), exec: (s) => t.exec(s) }))),
    close: () => lite.close(),
  };
}

// Apply migrations/*.sql in order, once each. A database that already has the 001 schema
// (applied by hand in Supabase before this runner existed) is adopted without re-running 001.
async function migrate(db) {
  await db.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await db.query(`select name from schema_migrations`)).rows.map((r) => r.name));
  if (!done.has('001_init.sql')) {
    const hasAgents = (await db.query(`select to_regclass('public.agents') as t`)).rows[0].t;
    if (hasAgents) {
      await db.query(`insert into schema_migrations (name) values ('001_init.sql')`);
      done.add('001_init.sql');
    }
  }
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
    await db.tx(async (t) => {
      await execScript(db, t, sql);
      await t.query(`insert into schema_migrations (name) values ($1)`, [f]);
    });
  }
}

// node-postgres runs multi-statement text as a simple query; PGlite uses exec().
function execScript(db, t, sql) {
  return t.exec ? t.exec(sql) : t.query(sql);
}
