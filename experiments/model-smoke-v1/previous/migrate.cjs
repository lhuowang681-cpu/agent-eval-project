// Isolated acceptance harness; never run against a user/production database.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const req = createRequire(path.resolve(__dirname, '../2026-11-08_platform_audit/platform/package.json'));
const { Client } = req('pg');
const { readMigrationFiles } = req('drizzle-orm/migrator');
(async () => {
  if (process.env.DATABASE_URL !== 'postgresql://postgres@127.0.0.1:15435/vnext_acceptance_20261114') throw new Error('isolated_database_required');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const version = (await db.query('SELECT version()')).rows[0].version;
  const migrations = readMigrationFiles({ migrationsFolder: path.resolve(__dirname, '../2026-11-08_platform_audit/platform/packages/database/migrations') });
  await db.query('CREATE SCHEMA IF NOT EXISTS drizzle');
  await db.query('CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)');
  const applied = new Set((await db.query('SELECT hash FROM drizzle.__drizzle_migrations')).rows.map(x => x.hash));
  const receipt = { version, applied: [], skipped: [], previouslyApplied: applied.size };
  for (const m of migrations) {
    if (applied.has(m.hash)) continue;
    if (m.sql.some(s => /pg_search|bm25/i.test(s))) {
      receipt.skipped.push({ hash: m.hash, reason: 'ParadeDB pg_search/BM25 is unavailable on this isolated standard PostgreSQL; no fake applied record is written.' });
      continue;
    }
    await db.query('BEGIN');
    try {
      for (const sql of m.sql) await db.query(sql);
      await db.query('INSERT INTO drizzle.__drizzle_migrations (hash,created_at) VALUES ($1,$2)', [m.hash,m.folderMillis]);
      await db.query('COMMIT');
      receipt.applied.push(m.hash);
    } catch (e) { await db.query('ROLLBACK'); throw e; }
  }
  receipt.extensions = (await db.query('SELECT extname,extversion FROM pg_extension')).rows;
  receipt.tableCount = (await db.query("SELECT count(*)::int n FROM information_schema.tables WHERE table_schema='public'")).rows[0].n;
  const originalReceipt = path.resolve(__dirname, 'results/postgres-migrations.json');
  if (!fs.existsSync(originalReceipt)) fs.writeFileSync(originalReceipt, JSON.stringify(receipt,null,2));
  fs.writeFileSync(path.resolve(__dirname, 'results/postgres-migrations-latest.json'), JSON.stringify(receipt,null,2));
  console.log(JSON.stringify({ version, applied: receipt.applied.length, skipped: receipt.skipped.length, tables: receipt.tableCount, extensions: receipt.extensions }));
  await db.end();
})().catch(e => { console.error(e); process.exitCode=1; });
