import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

/**
 * L2 服务集成层的独立 vitest 配置。
 *
 * 为什么不能复用根 `vitest.config.mts`：
 *   1. 根配置 `environment: 'happy-dom'` —— 这一层要打真 Redis / 真 PG，必须是 node 环境。
 *      （happy-dom 还会引入别的偏差，本轮就踩过一次：DOMPurify 在 happy-dom 下行为异常，
 *       差点被误报成 XSS，见新主机执行记录。）
 *   2. 根配置的 `setupFiles: tests/setup.ts` 面向前端组件测试，会装一堆浏览器 mock。
 *   3. 这一层依赖外部服务，不该混进默认测试集被 CI 无条件跑。
 *
 * 用法：
 *   bunx vitest run --config vitest.local.config.mts
 *   bunx vitest run --config vitest.local.config.mts tests/local/<某个文件>
 *
 * 前置：REDIS_URL 指向真 Redis；涉及 DB 的用例另需 DATABASE_URL。
 */
export default defineConfig({
  resolve: {
    alias: {
      // ⚠️ `@/database` 必须排在 `@` 前面，且指向 packages —— 与根 vitest 配置一致。
      // 仓库里服务端代码普遍写 `@/database/...`（如 `@/database/core/db-adaptor`），
      // 若只映射 `@` → src，它会解析到不存在的 `src/database/...`，
      // 表现为「导入成功但拿到的不是 drizzle 实例」这类难查的错。
      // 这四个前缀在 tsconfig 里指向 packages/，必须与根 vitest 配置保持一致，
      // 且都要排在 `@` 之前（否则会被更宽的 `@` 抢先解析到 src/）。
      '@/const': resolve(__dirname, './packages/const/src'),
      '@/database': resolve(__dirname, './packages/database/src'),
      '@/types': resolve(__dirname, './packages/types/src'),
      '@/utils': resolve(__dirname, './packages/utils/src'),
      '@lobechat/database': resolve(__dirname, './packages/database/src'),
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    // vitest 不会自动读 .env；这一层的 REDIS_URL / DATABASE_URL 全靠它，
    // 不加载就会在 beforeAll 里报「需要真 Redis」而全部 skip。
    setupFiles: [resolve(__dirname, './tests/local/setup.ts')],
    // 集成用例会真的连服务，比单测慢得多
    hookTimeout: 60_000,
    include: ['tests/local/**/*.integration.test.ts'],
    // 共享 Redis / 单个 PG，串行跑避免用例互相踩
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
  },
});
