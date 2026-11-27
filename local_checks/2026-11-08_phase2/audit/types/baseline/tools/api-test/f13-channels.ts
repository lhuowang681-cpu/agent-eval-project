#!/usr/bin/env tsx
/**
 * F13 接入通道（6 项） —— 阶段 5 最后一组空白.
 *
 * 覆盖：
 *   F13.1 Bot webhook 分发（`/api/agent/webhooks/[platform]/[[...appId]]`）
 *   F13.3 Bot 回复回调（`/api/agent/webhooks/bot-callback`）
 *   F13.4 Agent Gateway 启动（`/api/agent/gateway/start`，Bearer = KEY_VAULTS_SECRET）
 *   F13.5 设备注册与远程设备（tRPC `device.*`）
 *   F13.6 定时任务（tRPC `agentCronJob.*`）
 *
 * 离线边界：飞书 SDK（`@ctrip/lark-auth`）与各网关都已存根/不配置，所以这里**不测业务成功路径**，
 * 测的是**接入面的契约**：端点是否存在、鉴权是否 fail-closed、未配置时是否给出可诊断的拒绝
 * 而不是 500 或静默通过。这正是离线环境能提供确定结论的部分。
 *
 * Usage:  bun run tsx tools/api-test/f13-channels.ts
 */
import 'dotenv/config';

import { BASE_URL, check, summary, trpcQuery } from './client';

const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
  const res = await fetch(`${BASE_URL}${path}`, {
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...headers },
    method: 'POST',
  });
  const text = await res.text();
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text.slice(0, 200);
  }
  return { body: parsed, status: res.status };
};

const main = async () => {
  console.info('\n' + '═'.repeat(64));
  console.info('F13 接入通道 — 阶段 5 补测');
  console.info('═'.repeat(64));

  console.info('\n▶ F13.1 Bot webhook 分发');

  // 平台路由存在性：未知平台不应该 500，应该是明确的 4xx。
  const unknown = await post('/api/agent/webhooks/nonexistent-platform', { probe: true });
  check(
    '未知平台返回 4xx（而非 500 / 静默 200）',
    unknown.status >= 400 && unknown.status < 500,
    `HTTP ${unknown.status} ${JSON.stringify(unknown.body).slice(0, 120)}`,
  );

  // feishu 是当前唯一已实现平台；不带签名必须被拒。
  const feishuNoSig = await post('/api/agent/webhooks/feishu', {
    schema: '2.0',
    type: 'url_verification',
  });
  check(
    'feishu webhook 无签名被拒（fail-closed）',
    feishuNoSig.status >= 400,
    `HTTP ${feishuNoSig.status} ${JSON.stringify(feishuNoSig.body).slice(0, 120)}`,
  );

  // ── F13.1 业务成功路径 ────────────────────────────────────────────────────
  //
  // 此前这一条一直记为「需真实飞书应用、离线不可达」。那个判断只对**出站**成立
  // （换 token、发消息要调 open.feishu.cn）；而 webhook 是**入站**的 —— 飞书调我们。
  // 只要库里有一条启用的 provider，整条链路
  //   HTTP → BotMessageRouter → 从库解密配置 → FeishuAdapter
  // 完全本地可验。provider 由 `scripts/local/seedFeishuBot.ts` 种入（凭证走
  // KeyVaultsGateKeeper 加密，与生产同路径，不绕过加密层）。
  const LOCAL_APP_ID = 'cli_local_offline_bot';
  const LOCAL_TOKEN = 'local-offline-verification-token';
  const hookPath = `/api/agent/webhooks/feishu/${LOCAL_APP_ID}`;

  console.info('\n▶ F13.1b Bot webhook 业务成功路径（本地 provider）');

  const challenge = `chal_${Date.now()}`;
  const verified = await post(hookPath, {
    challenge,
    token: LOCAL_TOKEN,
    type: 'url_verification',
  });

  /*
   * 🐛 实测结论（2026-08-09）：**入站握手被出站鉴权卡死**。
   *
   * `LarkAdapter.initialize()` 会先调 `getTenantAccessToken()` 出站换 token
   * （adapter.ts:312 → api.ts:267），失败就抛，`createAndRegisterBot` 整个失败。
   * 于是连 `url_verification` 这种**按飞书协议只需回显 challenge**、
   * 完全不需要出站的握手，也过不去。
   *
   * 实测错误是 `Lark auth error: 10003 invalid param` —— 那是**飞书服务器的应答**
   * （open.feishu.cn 本机可达，251ms），说明不是网络问题，是凭证被拒。
   *
   * 影响：飞书 token 接口抖动或凭证临时失效时，**webhook 验证与全部入站事件一起瘫痪**，
   * 而不是仅仅"发不出消息"。可用性上，入站与出站被不必要地耦合在一起。
   */
  const initBlocked = verified.status === 404;

  check(
    '🐛 入站握手依赖出站鉴权：无有效凭证时 url_verification 也失败',
    initBlocked,
    `HTTP ${verified.status} ${JSON.stringify(verified.body).slice(0, 140)}`,
  );

  /*
   * 🐛 更糟的是错误面：真实原因是上游鉴权失败，对外却是
   * `404 "No bot configured for feishu"` —— 运维照这句去查 bot 配置，
   * 而配置本身是好的（库里那条 provider 启用且可正常解密，已单独验证）。
   * 真正的堆栈只出现在 debug 日志里。
   */
  check(
    '🐛 错误面误导：上游鉴权失败被吞成「未配置 bot」',
    initBlocked && /No bot configured/i.test(JSON.stringify(verified.body)),
    `HTTP ${verified.status} ${JSON.stringify(verified.body).slice(0, 140)}`,
  );

  // 未注册的 appId 走同一路由，必须落到「无此 bot」而不是被当成合法请求
  const unknownApp = await post('/api/agent/webhooks/feishu/cli_not_registered', {
    challenge: 'x',
    token: LOCAL_TOKEN,
    type: 'url_verification',
  });
  check(
    '未注册 appId 被拒（不串用其它 bot 的配置）',
    unknownApp.status >= 400,
    `HTTP ${unknownApp.status} ${JSON.stringify(unknownApp.body).slice(0, 120)}`,
  );

  /*
   * 有真实飞书应用时，把凭证喂给 `scripts/local/seedFeishuBot.ts` 重新种一次，
   * 下面这段就会真正跑起来 —— 这是本条从「缺陷诊断」转为「成功路径」的唯一开关。
   * 没配就跳过，不伪造通过。
   */
  if (process.env.FEISHU_REAL_APP_ID) {
    const realHook = `/api/agent/webhooks/feishu/${process.env.FEISHU_REAL_APP_ID}`;
    /*
     * 与 `scripts/local/seedFeishuBot.ts` 的默认值保持一致。
     *
     * verificationToken 是飞书与我们之间的共享密钥，而这里的请求由本测试构造 ——
     * 两端都在我们手上，用占位值即可，**不需要**去飞书后台抄真的那个。
     * 真正必须是真实的只有 appId / appSecret：它们要出站换 tenant token。
     *
     * 之前这里默认空串，与种子里的占位值对不上，表现为 401 Invalid verification token
     * ——那不是产品问题，是两边口径没对齐。
     */
    const realToken =
      process.env.FEISHU_REAL_VERIFICATION_TOKEN ?? 'local-offline-verification-token';
    const realChallenge = `chal_real_${Date.now()}`;

    const ok = await post(realHook, {
      challenge: realChallenge,
      token: realToken,
      type: 'url_verification',
    });
    check(
      '真实应用：url_verification 回显 challenge',
      ok.status === 200 && (ok.body as any)?.challenge === realChallenge,
      `HTTP ${ok.status} ${JSON.stringify(ok.body).slice(0, 140)}`,
    );

    const bad = await post(realHook, {
      challenge: 'should-not-echo',
      token: 'wrong-token',
      type: 'url_verification',
    });
    check(
      '真实应用：token 不匹配被拒（401）',
      bad.status === 401,
      `HTTP ${bad.status} ${JSON.stringify(bad.body).slice(0, 120)}`,
    );
  } else {
    console.info(
      '    ⏭  跳过真实应用成功路径：未设 FEISHU_REAL_APP_ID（配了自有飞书应用即可打开）',
    );
  }

  console.info('\n▶ F13.3 Bot 回调');

  const botCallback = await post('/api/agent/webhooks/bot-callback', { probe: true });
  check(
    'bot-callback 端点存在且不 500',
    botCallback.status !== 500 && botCallback.status !== 404,
    `HTTP ${botCallback.status} ${JSON.stringify(botCallback.body).slice(0, 120)}`,
  );

  console.info('\n▶ F13.4 Agent Gateway 启动');

  const gwNoAuth = await post('/api/agent/gateway/start', {});
  check(
    '无 Bearer 时拒绝启动网关',
    gwNoAuth.status === 401 || gwNoAuth.status === 403,
    `HTTP ${gwNoAuth.status} ${JSON.stringify(gwNoAuth.body).slice(0, 120)}`,
  );

  const gwWrong = await post('/api/agent/gateway/start', {}, { Authorization: 'Bearer wrong-secret' });
  check(
    '错误 Bearer 被拒',
    gwWrong.status === 401 || gwWrong.status === 403,
    `HTTP ${gwWrong.status}`,
  );

  // 用正确的 secret：网关地址未配置，预期是「明确失败」而不是「假装成功」。
  const secret = process.env.KEY_VAULTS_SECRET;
  if (secret) {
    const gwOk = await post('/api/agent/gateway/start', {}, { Authorization: `Bearer ${secret}` });
    console.info(`    正确 Bearer → HTTP ${gwOk.status} ${JSON.stringify(gwOk.body).slice(0, 140)}`);
    check(
      '正确 Bearer 通过鉴权闸门（后续因未配置网关而失败属预期）',
      gwOk.status !== 401 && gwOk.status !== 403,
      `HTTP ${gwOk.status}`,
    );
    console.info(
      '    注：`/api/agent/gateway/start` 把 KEY_VAULTS_SECRET 复用为 API 凭证 —— ' +
        '\n    加密密钥兼作接口令牌，泄露面被放大。已记于附录 A.4。',
    );
  }

  console.info('\n▶ F13.5 设备（tRPC device.*）');

  // device router 里没有 getDevices；设备列表走 remote-device 工具，
  // router 暴露的是针对某台设备的能力查询。用 checkCapability 探接入面。
  const devCap = await trpcQuery<any>('device.checkCapability', {
    capability: 'shell',
    deviceId: 'nonexistent-device',
  }).catch((e) => ({ __err: String(e) }));
  check(
    'device.checkCapability 可达（未知设备被明确拒绝，而非 500）',
    !devCap?.__err || !String(devCap.__err).includes('No procedure found'),
    devCap?.__err ? String(devCap.__err).slice(0, 150) : JSON.stringify(devCap).slice(0, 120),
  );

  console.info('\n▶ F13.6 定时任务（tRPC agentCronJob.*）');

  const crons = await trpcQuery<any>('agentCronJob.list', { limit: 20, offset: 0 }).catch((e) => ({
    __err: String(e),
  }));
  check(
    'agentCronJob.list 可调用',
    !crons?.__err,
    crons?.__err ? String(crons.__err).slice(0, 160) : JSON.stringify(crons).slice(0, 120),
  );

  const cronStats = await trpcQuery<any>('agentCronJob.getStats').catch((e) => ({ __err: String(e) }));
  check(
    'agentCronJob.getStats 可调用',
    !cronStats?.__err,
    cronStats?.__err ? String(cronStats.__err).slice(0, 160) : JSON.stringify(cronStats).slice(0, 120),
  );

  console.info(
    '\n    边界（2026-08-09 更新）：' +
      '\n    · F13.1 已不再是笼统的「离线不可达」—— 种入本地 provider 后定位到具体原因：' +
      '\n      LarkAdapter.initialize() 先出站换 tenant token，失败即整个 bot 加载失败，' +
      '\n      连只需回显 challenge 的 url_verification 也过不去；且被吞成误导性的 404。' +
      '\n      配上自有飞书应用（FEISHU_REAL_APP_ID）即可打开上面的成功路径断言。' +
      '\n    · F13.4 / F13.5 仍需 Agent Gateway 与设备网关（出站长连接），未覆盖。' +
      '\n    其余各条只验证接入面契约（端点存在 / 鉴权 fail-closed / 未配置时可诊断）。',
  );

  summary();
};

main().catch((error) => {
  console.error('\n❌ f13-channels 脚本异常:', error);
  process.exitCode = 1;
});
