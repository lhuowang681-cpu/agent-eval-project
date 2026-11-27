/**
 * L2 集成层的 setup：只做一件事 —— 把 .env 读进 process.env。
 *
 * vitest 不会自动加载 .env（Vite 的 loadEnv 只处理 VITE_ 前缀且用于客户端），
 * 而这一层的 REDIS_URL / DATABASE_URL / KEY_VAULTS_SECRET 全靠它。
 * 不加载的话，用例会在 beforeAll 报「需要真 Redis」并整体 skip ——
 * 那是**假绿**（skip 不算失败），比报错更危险。
 */
import 'dotenv/config';

if (!process.env.REDIS_URL) {
  throw new Error(
    'REDIS_URL 未设置。L2 集成层要求真 Redis —— 请确认 .env 里配了 REDIS_URL 且未设 DISABLE_REDIS。',
  );
}
