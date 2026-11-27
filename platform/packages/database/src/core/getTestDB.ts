import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { sql } from 'drizzle-orm';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle as nodeDrizzle } from 'drizzle-orm/node-postgres';
import { migrate as nodeMigrate } from 'drizzle-orm/node-postgres/migrator';
import { drizzle as pgliteDrizzle } from 'drizzle-orm/pglite';
import { Pool as NodePool } from 'pg';

import { serverDBEnv } from '@/config/db';

import * as schema from '../schemas';
import type { LobeChatDatabase } from '../type';

const migrationsFolder = join(__dirname, '../../migrations');

const isServerDBMode = process.env.TEST_SERVER_DB === '1';

let testClientDB: ReturnType<typeof pgliteDrizzle<typeof schema>> | null = null;
let testServerDB: ReturnType<typeof nodeDrizzle<typeof schema>> | null = null;

export const getTestDB = async (): Promise<LobeChatDatabase> => {
  // Server DB mode (node-postgres)
  if (isServerDBMode) {
    if (testServerDB) return testServerDB as unknown as LobeChatDatabase;

    const connectionString = serverDBEnv.DATABASE_TEST_URL;

    if (!connectionString) {
      throw new Error('DATABASE_TEST_URL is not set');
    }

    const client = new NodePool({ connectionString });
    testServerDB = nodeDrizzle(client, { schema });

    await nodeMigrate(testServerDB, { migrationsFolder });

    return testServerDB as unknown as LobeChatDatabase;
  }

  // Client DB mode (PGlite)
  if (testClientDB) return testClientDB as unknown as LobeChatDatabase;

  const pglite = new PGlite({ extensions: { vector } });
  testClientDB = pgliteDrizzle({ client: pglite, schema });

  // Custom migration that skips pg_search-related SQL for PGlite compatibility
  const migrations = readMigrationFiles({ migrationsFolder });

  await testClientDB.execute(sql`CREATE SCHEMA IF NOT EXISTS "drizzle"`);
  await testClientDB.execute(sql`
    CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `);

  /**
   * 把一段可能含多条语句的 SQL 按分号切开。
   *
   * 不能简单 `split(';')` —— 分号可能出现在：
   *   · 单引号字符串字面量里（`'a;b'`）
   *   · 标识符引号里（`"a;b"`）
   *   · dollar-quoted 函数体里（`$$ ... ; ... $$`，触发器/函数定义常见）
   * 误切会产生语法错误的碎片，比原来的问题更难查。
   */
  const splitSqlStatements = (raw: string): string[] => {
    const out: string[] = [];
    let buf = '';
    let inSingle = false;
    let inDouble = false;
    let dollarTag: string | null = null;

    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      if (dollarTag) {
        buf += ch;
        if (raw.startsWith(dollarTag, i)) {
          buf += raw.slice(i + 1, i + dollarTag.length);
          i += dollarTag.length - 1;
          dollarTag = null;
        }
        continue;
      }

      if (!inSingle && !inDouble && ch === '$') {
        const m = /^\$[A-Za-z_]*\$/.exec(raw.slice(i));
        if (m) {
          dollarTag = m[0];
          buf += m[0];
          i += m[0].length - 1;
          continue;
        }
      }

      if (!inDouble && ch === "'") inSingle = !inSingle;
      else if (!inSingle && ch === '"') inDouble = !inDouble;

      if (ch === ';' && !inSingle && !inDouble) {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
        continue;
      }

      buf += ch;
    }

    if (buf.trim()) out.push(buf.trim());
    return out;
  };

  for (const migration of migrations) {
    const skipSql = migration.sql.some(
      (s) => s.toLowerCase().includes('pg_search') || s.toLowerCase().includes('bm25'),
    );

    if (!skipSql) {
      for (const stmt of migration.sql) {
        // 一条 `migration.sql` 条目里可能含多条 SQL —— drizzle 按
        // `--> statement-breakpoint` 切分，手写的迁移文件如果漏了分隔符，
        // 三条 UPDATE 就会挤在同一个条目里。
        //
        // 而 `execute(sql.raw(...))` 走的是扩展查询协议（预处理语句），
        // **不接受多命令**，会报 `cannot insert multiple commands into a prepared
        // statement`(42601)。迁移就此中断，之后所有迁移都不再应用，
        // 后续用例插数据时报「列不存在」—— 实测连锁出 22 个失败 / 62 个跳过，
        // 也正因如此 packages/database 的 91 个测试文件长期没人跑通过。
        //
        // 这里按分号切开逐条执行，与 scripts/local/pgliteServer.ts 用
        // `db.exec()`（简单查询协议，本就允许多命令）跑得通是同一个道理。
        for (const single of splitSqlStatements(stmt)) {
          await testClientDB.execute(sql.raw(single));
        }
      }
    }

    await testClientDB.execute(
      sql`INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`,
    );
  }

  return testClientDB as unknown as LobeChatDatabase;
};
