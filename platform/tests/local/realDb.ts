import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from '@/database/schemas';

/**
 * L2 层专用：直连真实 PostgreSQL。
 *
 * ⚠️ 不能用应用侧的 `getServerDB()` —— `packages/database/src/core/web-server.ts` 里有：
 *
 *     if (process.env.NODE_ENV === 'test') return {} as LobeChatDatabase;
 *
 * vitest 会把 `NODE_ENV` 设成 `test`，于是它返回一个**空对象**。
 * `{} as LobeChatDatabase` 是类型谎言：调用方拿到的不是「数据库不可用」的清晰报错，
 * 而是运行到具体语句时才炸的 `db.insert is not a function`，排查成本很高。
 *
 * L2 这一层的全部意义就是打真服务，所以这里绕过该适配器自己建连接。
 */

let cached: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: Pool | null = null;

export const getRealDB = () => {
  if (cached) return cached;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('L2 需要真 PostgreSQL：请在 .env 里设置 DATABASE_URL');
  }

  pool = new Pool({ connectionString });
  cached = drizzle(pool, { schema });
  return cached;
};

export const closeRealDB = async () => {
  await pool?.end();
  pool = null;
  cached = null;
};
