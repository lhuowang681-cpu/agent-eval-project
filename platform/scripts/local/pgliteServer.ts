#!/usr/bin/env tsx
/**
 * PGlite-backed Postgres server for offline development.
 *
 * WHY THIS EXISTS
 * The app's server runtime talks to Postgres over the wire (node-postgres / neon
 * driver), so it needs a listening server — `getTestDB.ts`'s in-process PGlite only
 * serves Vitest. Standing up a real Postgres on this machine needs Docker or WSL,
 * both of which require an elevated UAC prompt that a non-interactive session cannot
 * drive. PGlite ships a full Postgres compiled to WASM *including pgvector*, and
 * `@electric-sql/pglite-socket` fronts it with the Postgres wire protocol — so the
 * app connects via a normal DATABASE_URL and never knows the difference.
 *
 * ⚠️ KNOWN DIVERGENCES FROM REAL POSTGRES — read before trusting any result
 *
 *  1. CONCURRENCY. PGlite is single-threaded WASM and serialises every query through
 *     an internal queue; `maxConnections` only controls how many sockets may wait.
 *     Functional behaviour is faithful, but connection-pool behaviour, lock contention
 *     and throughput are NOT. **Do not draw phase-6 performance conclusions from this.**
 *
 *  2. NO pg_search / BM25. Migrations mentioning `pg_search` or `bm25` are skipped,
 *     mirroring `packages/database/src/core/getTestDB.ts`. Full-text search paths that
 *     rely on the BM25 index will behave differently or fail.
 *
 *  3. Extension set is limited to what PGlite bundles. `vector` is present; anything
 *     else the schema wants may not be.
 *
 * Usage
 *   bun run tsx scripts/local/pgliteServer.ts
 *   PGLITE_PORT=5432 PGLITE_DATA_DIR=.pglite-data bun run tsx scripts/local/pgliteServer.ts
 *   PGLITE_FRESH=1 bun run tsx scripts/local/pgliteServer.ts     # wipe and re-migrate
 *
 * Then point the app at it:
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
 *   DATABASE_DRIVER=node
 */
// NOTE ON VERSIONS
// `@lobechat/database` depends on pglite ^0.3.14 for its in-process Vitest DB
// (getTestDB.ts). This script instead uses the root devDependency pglite 0.5.4,
// because `@electric-sql/pglite-socket@0.2.7` peer-requires exactly that — 0.3.x has no
// `execProtocolRawStream`, which the socket server needs. pnpm keeps the two versions
// isolated, so the test path is unaffected.
// In 0.5.x pgvector moved out of the core package into `@electric-sql/pglite-pgvector`.
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname ?? __dirname, '..', '..');
const migrationsFolder = join(repoRoot, 'packages', 'database', 'migrations');

const PORT = Number(process.env.PGLITE_PORT ?? 5432);
const HOST = process.env.PGLITE_HOST ?? '127.0.0.1';
const DATA_DIR = resolve(repoRoot, process.env.PGLITE_DATA_DIR ?? '.pglite-data');
const MAX_CONNECTIONS = Number(process.env.PGLITE_MAX_CONNECTIONS ?? 10);
const FRESH = process.env.PGLITE_FRESH === '1';

const main = async () => {
  if (FRESH && existsSync(DATA_DIR)) {
    console.info(`[pglite] PGLITE_FRESH=1 — removing ${DATA_DIR}`);
    rmSync(DATA_DIR, { force: true, recursive: true });
  }

  const isFirstRun = !existsSync(DATA_DIR);

  console.info(`[pglite] data dir: ${DATA_DIR}${isFirstRun ? ' (new)' : ''}`);
  const db = new PGlite({ dataDir: DATA_DIR, extensions: { vector } });
  await db.waitReady;

  await db.exec('CREATE EXTENSION IF NOT EXISTS vector;');
  console.info('[pglite] vector extension ready');

  // ---- migrations ----------------------------------------------------------
  // Mirrors packages/database/src/core/getTestDB.ts: run every migration except the
  // pg_search / BM25 ones, and still record them as applied so drizzle stays in sync.
  const migrations = readMigrationFiles({ migrationsFolder });

  await db.exec('CREATE SCHEMA IF NOT EXISTS "drizzle";');
  await db.exec(`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    );
  `);

  const appliedRows = await db.query<{ hash: string }>(
    'SELECT hash FROM "drizzle"."__drizzle_migrations"',
  );
  const applied = new Set(appliedRows.rows.map((r) => r.hash));

  let ran = 0;
  let skipped = 0;

  for (const migration of migrations) {
    if (applied.has(migration.hash)) continue;

    const usesPgSearch = migration.sql.some(
      (s) => s.toLowerCase().includes('pg_search') || s.toLowerCase().includes('bm25'),
    );

    if (usesPgSearch) {
      skipped += 1;
    } else {
      for (const stmt of migration.sql) {
        try {
          await db.exec(stmt);
        } catch (error) {
          console.error(`[pglite] migration failed (hash ${migration.hash.slice(0, 8)}):`);
          console.error(`  statement: ${stmt.slice(0, 200)}`);
          throw error;
        }
      }
      ran += 1;
    }

    await db.query('INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES ($1, $2)', [
      migration.hash,
      migration.folderMillis,
    ]);
  }

  const tables = await db.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema = 'public'",
  );

  console.info(
    `[pglite] migrations: ${ran} applied, ${skipped} skipped (pg_search/bm25), ` +
      `${migrations.length - ran - skipped} already present`,
  );
  console.info(`[pglite] public tables: ${tables.rows[0]?.count ?? 0}`);

  if (skipped > 0) {
    console.warn(
      `[pglite] ⚠️  ${skipped} migration(s) skipped — BM25 full-text search paths will not behave like real Postgres.`,
    );
  }

  // ---- socket server -------------------------------------------------------
  const server = new PGLiteSocketServer({
    db,
    debug: process.env.PGLITE_DEBUG === '1',
    host: HOST,
    inspect: process.env.PGLITE_INSPECT === '1',
    maxConnections: MAX_CONNECTIONS,
    port: PORT,
  });

  server.addEventListener('error', (e) => console.error('[pglite] socket error:', (e as any).detail));
  server.addEventListener('connection', () => console.info('[pglite] client connected'));

  await server.start();

  console.info(`[pglite] listening on ${HOST}:${PORT} (maxConnections=${MAX_CONNECTIONS})`);
  console.info(`[pglite] DATABASE_URL=postgresql://postgres:postgres@${HOST}:${PORT}/postgres`);
  console.warn('[pglite] ⚠️  queries are serialised internally — not valid for load testing.');

  const shutdown = async (signal: string) => {
    console.info(`\n[pglite] ${signal} — shutting down`);
    await server.stop();
    await db.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
};

main().catch((error) => {
  console.error('[pglite] fatal:', error);
  process.exit(1);
});
