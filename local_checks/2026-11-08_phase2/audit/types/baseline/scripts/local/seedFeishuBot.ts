/**
 * 在本地数据库里种一个**启用的**飞书 bot provider，用于打通 F13.1 的业务成功路径。
 *
 * 为什么这么做就够：飞书 bot webhook 是**入站**的 —— 飞书调我们，不是我们调飞书。
 * 所以只要 ① 库里有一条能被 `BotMessageRouter` 加载到的启用 provider，
 * ② 请求体带上与之匹配的 verification token，整条链路
 * （HTTP → 路由 → 从库解密配置 → 适配器应答）就能真实跑通，**不需要任何外部服务**。
 *
 * 这与「需要真实飞书应用」的判断并不矛盾：真实应用是**对外发消息**才需要的
 * （调 open.feishu.cn 换 token、发卡片）。入站校验与分发这一段是本地可验的。
 *
 * 凭证走 `KeyVaultsGateKeeper` 加密，与生产同一条路径 —— 不绕过加密层，
 * 否则验的就不是真实读取逻辑了。
 *
 * 用法：bun x tsx scripts/local/seedFeishuBot.ts
 * 输出：appId 与 verificationToken，供 tools/api-test/f13-channels.ts 使用。
 */
// 必须在最前：db-adaptor 在 import 期就会读 DATABASE_URL / KEY_VAULTS_SECRET
import 'dotenv/config';

import { eq } from 'drizzle-orm';

import { getServerDB } from '../../packages/database/src/core/db-adaptor';
import { agentBotProviders, agents } from '../../packages/database/src/schemas';
import { KeyVaultsGateKeeper } from '../../src/server/modules/KeyVaultsEncrypt';

/*
 * 默认种一个**占位** bot：足以验证「路由 → 从库解密配置 → 适配器」这段，
 * 但因为凭证是假的，`LarkAdapter.initialize()` 出站换 token 会失败
 * （这本身就是 §22.3 记录的缺陷之一）。
 *
 * 想跑通真实成功路径：设置下面三个环境变量后重跑本脚本即可，**无需改代码**。
 * 用自己租户的自建应用就行 —— 不涉及任何内网，也**不需要公网回调地址**
 * （测试是在本地构造飞书会发来的请求，飞书不需要能访问到你）。
 */
export const LOCAL_FEISHU_APP_ID = process.env.FEISHU_REAL_APP_ID || 'cli_local_offline_bot';
export const LOCAL_FEISHU_VERIFICATION_TOKEN =
  process.env.FEISHU_REAL_VERIFICATION_TOKEN || 'local-offline-verification-token';
const APP_SECRET =
  process.env.FEISHU_REAL_APP_SECRET || 'local-offline-app-secret-not-used-outbound';

const USER_ID = process.env.MOCK_DEV_USER_ID || 'offline-dev-user';
const AGENT_ID = 'agt_local_feishu_bot';

const main = async () => {
  const db = await getServerDB();
  const gateKeeper = await KeyVaultsGateKeeper.initWithEnvKey();

  // 1. agent（provider 有外键指向它）
  const [existingAgent] = await db.select().from(agents).where(eq(agents.id, AGENT_ID)).limit(1);
  if (!existingAgent) {
    await db.insert(agents).values({
      id: AGENT_ID,
      title: '本地飞书 Bot 测试助理',
      userId: USER_ID,
    } as any);
    console.info(`✓ 已创建 agent ${AGENT_ID}`);
  } else {
    console.info(`· agent ${AGENT_ID} 已存在`);
  }

  // 2. provider —— 凭证加密后落库
  const credentials = JSON.stringify({
    appId: LOCAL_FEISHU_APP_ID,
    appSecret: APP_SECRET,
    verificationToken: LOCAL_FEISHU_VERIFICATION_TOKEN,
  });
  const encrypted = await gateKeeper.encrypt(credentials);

  const [existing] = await db
    .select()
    .from(agentBotProviders)
    .where(eq(agentBotProviders.applicationId, LOCAL_FEISHU_APP_ID))
    .limit(1);

  if (existing) {
    await db
      .update(agentBotProviders)
      .set({ credentials: encrypted, enabled: true })
      .where(eq(agentBotProviders.id, existing.id));
    console.info('✓ 已更新既有 provider');
  } else {
    await db.insert(agentBotProviders).values({
      agentId: AGENT_ID,
      applicationId: LOCAL_FEISHU_APP_ID,
      credentials: encrypted,
      enabled: true,
      platform: 'feishu',
      userId: USER_ID,
    } as any);
    console.info('✓ 已创建 provider');
  }

  console.info(`
  appId              = ${LOCAL_FEISHU_APP_ID}
  verificationToken  = ${LOCAL_FEISHU_VERIFICATION_TOKEN}
  webhook            = POST /api/agent/webhooks/feishu/${LOCAL_FEISHU_APP_ID}
`);

  process.exit(0);
};

main().catch((e) => {
  console.error('seedFeishuBot 失败:', e);
  process.exit(1);
});
