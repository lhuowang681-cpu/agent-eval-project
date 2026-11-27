#!/usr/bin/env tsx
/**
 * 给离线 dev 用户签发一个 API Key，并把明文打印出来。
 *
 * 为什么需要它：
 *   离线环境一直靠开发态旁路（`lobe-auth-dev-backend-api: 1` + MOCK_DEV_USER_ID）鉴权，
 *   而这三处入口都有 `NODE_ENV === 'development'` 守卫。
 *   一旦用 `next start` 跑生产构建，NODE_ENV 变成 production，**旁路全部失效** ——
 *   这本身正是 F11.6 想要的行为（安全回归），但也意味着生产模式下的压测
 *   拿不到任何需要鉴权的端点。
 *
 *   `/api/v1/*` 支持第二种凭证：`Authorization: Bearer sk-lh-{16}`（ApiKeyModel + 5 分钟内存缓存）。
 *   所以生产模式测量改走 API Key + REST。注意 tRPC 不吃 API Key（走 OIDC/session），
 *   因此 `aiChat.*` / `aiAgent.*` 在生产模式下仍然测不到 —— 能覆盖的是
 *   `/api/v1/*` 全部 REST 端点，含 `POST /api/v1/responses`（对外唯一的完整 agent 入口）。
 *
 * 明文 key 只在创建时可见：库里存的是 KeyVaults 加密值 + HMAC-SHA256 的 keyHash
 * （utils/server/apiKeyHash.ts，密钥取 KEY_VAULTS_SECRET），无法反推。
 *
 * Usage:  bun run tsx scripts/local/seedApiKey.ts
 *         bun run tsx scripts/local/seedApiKey.ts --name bench
 */
import 'dotenv/config';

import { getServerDB } from '../../packages/database/src/core/db-adaptor';
import { apiKeys } from '../../packages/database/src/schemas';
import { KeyVaultsGateKeeper } from '../../src/server/modules/KeyVaultsEncrypt';
import { generateApiKey } from '../../packages/utils/src/apiKey';
import { hashApiKey } from '../../packages/utils/src/server/apiKeyHash';

const argv = process.argv.slice(2);
const nameIdx = argv.indexOf('--name');
const NAME = nameIdx > -1 ? argv[nameIdx + 1] : `offline-bench-${Date.now()}`;

const main = async () => {
  const userId = process.env.MOCK_DEV_USER_ID;

  if (process.env.NODE_ENV === 'production') {
    console.error('\n❌ 拒绝在 NODE_ENV=production 下签发 key。此脚本仅供本地离线使用。\n');
    process.exitCode = 1;
    return;
  }
  if (!userId) {
    console.error('\n❌ MOCK_DEV_USER_ID 未设置。\n');
    process.exitCode = 1;
    return;
  }
  if (!process.env.KEY_VAULTS_SECRET) {
    console.error('\n❌ KEY_VAULTS_SECRET 未设置 —— keyHash 与加密都依赖它。\n');
    process.exitCode = 1;
    return;
  }

  const db = await getServerDB();

  // 不能直接用 ApiKeyModel.create()：它内部生成明文后只把**加密值**写进 `key` 字段
  // 并原样返回该行，明文当场就丢了。这里复刻它的三步（generate → hash → encrypt），
  // 但把明文留在手里，否则生产模式下没有任何可用凭证。
  const plain = generateApiKey();
  const keyHash = hashApiKey(plain);
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();
  const encryptedKey = await gateKeeper.encrypt(plain);

  const [row] = await db
    .insert(apiKeys)
    .values({ enabled: true, key: encryptedKey, keyHash, name: NAME, userId })
    .returning();

  console.info(`\n✅ 已为 ${userId} 签发 API Key`);
  console.info(`   name : ${NAME}`);
  console.info(`   id   : ${row?.id}`);
  console.info(`\n   明文 KEY（库里只存密文与 HMAC，无法反推，请立刻保存）：\n   ${plain}\n`);
  console.info('   用法：');
  console.info(`   curl -H "Authorization: Bearer ${plain}" http://localhost:3010/api/v1/users/me`);
  console.info(`\n   压测用：$env:TEST_API_KEY = "${plain}"\n`);
};

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('\n❌ seedApiKey failed:', error);
    process.exit(1);
  });
