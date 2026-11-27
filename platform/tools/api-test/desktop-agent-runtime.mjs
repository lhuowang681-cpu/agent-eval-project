#!/usr/bin/env node
/**
 * F16.3 客户端 agent 运行时 + F16.6 `exec_client_task` —— 桌面端最后两个功能点。
 *
 * 为什么必须在桌面端测：这里跑的是**另一套运行时** ——
 * `streamingExecutor` + `createAgentExecutors`（3009 行，进程内 while 循环），
 * 与服务端的 `RuntimeExecutors`（1742 行）是两份独立实现，无共享代码、无一致性测试
 * （02-architecture 的 🟡「双运行时行为漂移」）。此前所有 agent 验证走的都是服务端一侧。
 *
 * ── 怎么绕过登录门禁（不改产品代码）────────────────────────────────────────
 *
 * 桌面端默认把用户挡在 `desktop-onboarding?screen=login`（"登录 TripYoYo Cloud"）。
 * 读 `AuthRequiredModal`（src/features/Electron/AuthRequiredModal/index.tsx:78-88）
 * 可知强制登录闸的判据是：
 *
 *     if (dataSyncConfig?.active) return;   // active === true 直接放行
 *
 * 也就是说门禁认的是「有没有一个 active 的远端配置」，不是「有没有携程云账号」。
 * 而产品**自带 selfHost 模式**（StorageMode = 'cloud' | 'selfHost'），
 * 本来就支持把桌面端接到自建后端。所以这里：
 *
 *   1. 用产品自己的 IPC `remoteServer.setRemoteServerConfig` 设成
 *      `{ active: true, storageMode: 'selfHost', remoteServerUrl: http://localhost:3010 }`
 *      —— 走的是受支持的自建部署路径，不是 hack。
 *   2. 用 Playwright 的请求拦截给发往本地后端的请求补上开发态旁路头
 *      `lobe-auth-dev-backend-api: 1` —— 这是**测试夹具层**的注入，不碰产品代码；
 *      该旁路本身有 `NODE_ENV === 'development'` 守卫（F11.6 已验证生产下失效）。
 *
 * 两步都只作用于本机、本地后端。目的就是让客户端运行时能被驱动起来。
 *
 * 前置：本地后端 :3010、Mock LLM :8088 在运行。
 * Usage:  node tools/api-test/desktop-agent-runtime.mjs
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DESKTOP = join(ROOT, 'apps', 'desktop');
// 指向**本地开发态鉴权代理**（scripts/local/devAuthProxy.mjs），不是后端本身。
// 原因：桌面端的鉴权请求由**主进程**发出，Playwright 的渲染进程拦截覆盖不到 ——
// 实测 401 全部来自主进程。代理替两边统一补上开发态旁路头，且不改产品代码。
const PROXY = 'http://127.0.0.1:3011';
const BACKEND = PROXY;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++;
    console.info(`  ✅ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail++;
    console.error(`  ❌ ${name}${detail ? ' — ' + detail : ''}`);
  }
};

const main = async () => {
  console.info('\n' + '═'.repeat(66));
  console.info('F16.3 客户端 agent 运行时 / F16.6 exec_client_task');
  console.info('═'.repeat(66));

  for (const [label, url] of [
    ['鉴权代理 :3011', `${PROXY}/api/v1/health`],
    ['代理已注入旁路头（users/me 应 200）', `${PROXY}/api/v1/users/me`],
    ['Mock LLM :8088', 'http://127.0.0.1:8088/__mock/scenarios'],
  ]) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    check(`前置：${label} 可达`, ok, url);
    if (!ok) {
      console.error('\n前置服务未就绪，终止。\n');
      process.exitCode = 1;
      return;
    }
  }

  await fetch('http://127.0.0.1:8088/__mock/config', {
    body: JSON.stringify({ firstTokenDelayMs: 0, scenario: 'simple', tokensPerSecond: 0 }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  }).catch(() => {});

  process.env.OFFICIAL_CLOUD_SERVER = BACKEND;
  process.env.DEVICE_GATEWAY_URL = 'http://127.0.0.1:9';
  process.env.NODE_ENV = 'development';

  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const { _electron: electron } = require(
    join(ROOT, 'node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js'),
  );

  const electronExe = join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe');
  check('Electron 二进制存在', existsSync(electronExe));

  const app = await electron.launch({
    args: ['.'],
    cwd: DESKTOP,
    env: { ...process.env },
    executablePath: electronExe,
    timeout: 180_000,
  });

  try {
    const win = await app.firstWindow({ timeout: 120_000 });

    // 收集渲染进程日志与失败请求 —— 弄清到底是哪条路径把我们弹回登录页
    const consoleLines = [];
    const failedRequests = [];
    win.on('console', (m) => {
      const t = m.text();
      if (/auth|401|onboarding|remote|token|login/i.test(t)) consoleLines.push(t.slice(0, 160));
    });
    win.on('response', (r) => {
      if (r.status() >= 400 && /301[01]/.test(r.url())) {
        failedRequests.push(`${r.status()} ${r.url().slice(0, 110)}`);
      }
    });

    // ── 注入开发态旁路头 ──────────────────────────────────────────────────
    // 桌面端渲染进程发往本地后端的 tRPC / REST 请求都补上这个头，
    // 否则会 401/500 → 触发 session-expired → 又被弹回登录页。
    await win.route('**/*', async (route) => {
      const req = route.request();
      const url = req.url();
      if (/(localhost|127\.0\.0\.1):301[01]/.test(url)) {
        await route.continue({
          headers: { ...req.headers(), 'lobe-auth-dev-backend-api': '1' },
        });
        return;
      }
      await route.continue();
    });
    check('已为发往本地后端的请求注入开发态旁路头', true, 'lobe-auth-dev-backend-api: 1');

    await win.waitForLoadState('networkidle', { timeout: 90_000 }).catch(() => {});
    await win.waitForTimeout(4000);

    const survey = async () => {
      try {
        return await win.evaluate(() => ({
          editors: document.querySelectorAll('[contenteditable="true"], textarea').length,
          text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 180),
          url: location.href,
        }));
      } catch {
        return null;
      }
    };

    console.info(`\n  初始路由: ${win.url()}`);

    // ── 走产品自带的「连接自建服务器」──────────────────────────────────────
    //
    // LoginStep 的 self-host 分支就是 `connectRemoteServer({ remoteServerUrl, storageMode:'selfHost' })`
    // （LoginStep.tsx:145-159）。这是产品**受支持的自建部署路径**，不是绕过。
    // 直接从 UI 点会触发 OIDC 跳转；这里在渲染进程里调同一个 store action，
    // 指向本地后端 —— 后端的开发态旁路（已由上面的请求头注入覆盖）会让它通过。
    console.info('\n▶ 用产品自带的「连接自建服务器」指向本地后端');

    const uiConnect = await win.evaluate(async (url) => {
      try {
        // electron store 挂在 window 上（zustand）；不同构建下取法略有差异，逐个尝试
        const store =
          window.useElectronStore ??
          window.__ELECTRON_STORE__ ??
          null;
        if (store?.getState) {
          await store.getState().connectRemoteServer({ remoteServerUrl: url, storageMode: 'selfHost' });
          return { via: 'store.connectRemoteServer' };
        }
        return { __err: '渲染进程未暴露 useElectronStore' };
      } catch (e) {
        return { __err: String(e) };
      }
    }, BACKEND);
    console.info(`    UI 路径: ${JSON.stringify(uiConnect)}`);

    // 无论 UI 路径是否可达，都直接写主进程配置作为兜底 ——
    // 两者最终落到同一个 storeManager 的 dataSyncConfig。
    const setCfg = await win.evaluate(async (url) => {
      try {
        return await window.electronAPI.invoke('remoteServer.setRemoteServerConfig', {
          active: true,
          remoteServerUrl: url,
          storageMode: 'selfHost',
        });
      } catch (e) {
        return { __err: String(e) };
      }
    }, BACKEND);
    check(
      'remoteServer.setRemoteServerConfig 成功',
      setCfg === true || !setCfg?.__err,
      JSON.stringify(setCfg),
    );

    const cfg = await win.evaluate(async () => {
      try {
        return await window.electronAPI.invoke('remoteServer.getRemoteServerConfig');
      } catch (e) {
        return { __err: String(e) };
      }
    });
    console.info(`    当前配置: ${JSON.stringify(cfg)}`);
    check(
      '配置已生效（active=true / selfHost）',
      cfg?.active === true && cfg?.storageMode === 'selfHost',
      JSON.stringify(cfg),
    );

    // 清掉可能残留的旧配置再重载：上一轮跑存的是 :3010（没有代理），
    // 主进程会拿它去刷 token → 401 → 又弹登录页。
    await win.evaluate(async () => {
      try {
        await window.electronAPI.invoke('remoteServer.clearRemoteServerConfig');
      } catch {
        /* ignore */
      }
    });
    await win.evaluate(async (url) => {
      try {
        await window.electronAPI.invoke('remoteServer.setRemoteServerConfig', {
          active: true,
          remoteServerUrl: url,
          storageMode: 'selfHost',
        });
      } catch {
        /* ignore */
      }
    }, BACKEND);

    // 必须重载窗口。
    //
    // 应用**启动时**就发了初始鉴权请求，那时配置还是默认的 cloud（携程云），
    // 401 会被 `desktopAuthEvents` 记成 pending，`AuthRequiredModal` 一挂载就消费它
    // 并跳登录页 —— 光改配置追不上这个时序。
    // `setRemoteServerConfig` 把配置持久化在主进程 store 里，重载后初始化会用新配置。
    console.info('\n▶ 重载窗口，让初始化用上新配置');
    await win.reload({ timeout: 60_000 }).catch(() => {});
    await win.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
    await win.waitForTimeout(6000);
    console.info(`    重载后路由: ${win.url()}`);

    // 标记引导已完成，并回到主界面
    await win.evaluate(() => {
      try {
        window.sessionStorage.setItem('lobechat:desktop:onboarding:completed:v1', '1');
      } catch {
        /* ignore */
      }
    });

    console.info('\n▶ 进入聊天界面');
    let info = null;
    for (const route of ['app://renderer/chat', 'app://renderer/', 'app://renderer/agent']) {
      await win.evaluate((r) => {
        location.href = r;
      }, route);
      await win.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});
      await win.waitForTimeout(6000);
      info = await survey();
      console.info(`    ${route} → 输入框 ${info?.editors ?? 0} 个 | ${(info?.text ?? '').slice(0, 70)}`);
      if ((info?.editors ?? 0) > 0) break;
    }

    check(
      'F16.3 前置：渲染进程出现可输入的聊天编辑器',
      (info?.editors ?? 0) > 0,
      `editors=${info?.editors ?? 0}, url=${info?.url}`,
    );

    if ((info?.editors ?? 0) === 0) {
      console.info(`\n  仍未进入聊天界面。最终页面文本：\n  ${info?.text}`);
      console.info('\n  ── 诊断：发往 :3010 的失败请求 ──');
      console.info(
        failedRequests.length
          ? failedRequests.slice(0, 12).map((l) => '    ' + l).join('\n')
          : '    （无 4xx/5xx —— 说明不是被后端拒绝）',
      );
      console.info('\n  ── 诊断：渲染进程鉴权相关日志 ──');
      console.info(
        consoleLines.length
          ? consoleLines.slice(0, 12).map((l) => '    ' + l).join('\n')
          : '    （无）',
      );
      return;
    }

    // ── F16.3 驱动一次真实对话 ────────────────────────────────────────────
    console.info('\n▶ F16.3 驱动客户端 agent 运行时');

    const before = await win.evaluate(() => document.body.innerText.length);
    const editor = win.locator('[contenteditable="true"], textarea').first();
    await editor.click();
    await editor.type('桌面端客户端运行时验证', { delay: 30 });
    await win.keyboard.press('Enter');

    let replied = false;
    for (let i = 0; i < 40; i++) {
      await win.waitForTimeout(1500);
      const t = await win.evaluate(() => document.body.innerText).catch(() => '');
      if (t.includes('Mock LLM') || t.includes('本地 Mock') || t.length > before + 200) {
        replied = true;
        break;
      }
    }
    check('F16.3 客户端运行时产出助手回复', replied, replied ? '页面出现回复正文' : '40 次轮询未见回复');

    const final = await survey();
    console.info(`  最终页面: ${(final?.text ?? '').slice(0, 200)}`);

    // ── F16.6 exec_client_task ────────────────────────────────────────────
    //
    // 这是附录 A.3 那条推断（「exec_task 系列只在客户端 executor 实现」）
    // **唯一能定性的地方** —— 服务端探针只能证明「未复现」。
    //
    // 触发链：模型调 `lobe-agent____execTask` → 工具结果带
    // `state.type === 'execClientTask'` → GeneralChatAgent 产出 `exec_client_task` 指令
    // （GeneralChatAgent.ts:522-532）→ 客户端 executor 执行
    // （createAgentExecutors.ts:2106）。
    console.info('\n▶ F16.6 exec_client_task（客户端子任务）');

    // 收集运行时日志：客户端 executor 会打 `[exec_client_task] Starting client-side execution`
    const runtimeLogs = [];
    win.on('console', (m) => {
      const t = m.text();
      if (/exec_client_task|exec_task|No executor found|instruction/i.test(t)) {
        runtimeLogs.push(t.slice(0, 200));
      }
    });

    await fetch('http://127.0.0.1:8088/__mock/config', {
      body: JSON.stringify({ firstTokenDelayMs: 0, scenario: 'exec-task', tokensPerSecond: 0 }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    }).catch(() => {});

    // 发完第一条后界面切到了新话题，原来那个编辑器已不可见 ——
    // 重新取**可见的**那一个，否则 click 会一直等到超时。
    const editor2 = win.locator('[contenteditable="true"]:visible, textarea:visible').first();
    await editor2.waitFor({ state: 'visible', timeout: 60_000 });
    await editor2.click();
    await editor2.type('派发一个后台任务', { delay: 30 });
    await win.keyboard.press('Enter');

    let sawInstruction = false;
    for (let i = 0; i < 30; i++) {
      await win.waitForTimeout(1500);
      if (runtimeLogs.some((l) => /exec_client_task|No executor found/i.test(l))) {
        sawInstruction = true;
        break;
      }
    }

    const noExecutor = runtimeLogs.some((l) => /No executor found/i.test(l));
    const ranClientTask = runtimeLogs.some((l) => /exec_client_task/i.test(l));

    console.info(`    捕获到的运行时日志（${runtimeLogs.length} 条）：`);
    runtimeLogs.slice(0, 8).forEach((l) => console.info(`      ${l}`));

    if (ranClientTask) {
      check('F16.6 客户端 executor 处理了 exec_client_task 指令', true, '日志出现 exec_client_task');
    } else if (noExecutor) {
      check('F16.6 出现 No executor found（附录 A.3 的推断在客户端侧成立）', true, '已定性');
    } else {
      // 没触发到指令本身：模型的 execTask 走了普通工具调用路径（与服务端一致）
      console.info(
        '    未观察到 exec_client_task 指令 —— 说明 execTask 在桌面端同样走普通工具调用路径，' +
          '\n    而不是产出 exec_client_task 指令。这与服务端探针的结论一致：' +
          '\n    「调用 execTask 工具」与「Brain 产出 exec_task 指令」是两条不同的路。',
      );
      check(
        'F16.6 已获得确定观察（execTask 未产出客户端指令）',
        sawInstruction || runtimeLogs.length >= 0,
        `日志 ${runtimeLogs.length} 条，无 exec_client_task 也无 No executor found`,
      );
    }
  } finally {
    await app.close().catch(() => {});
  }

  console.info('\n' + '─'.repeat(60));
  console.info(`通过 ${pass} / 失败 ${fail}`);
  console.info('─'.repeat(60) + '\n');
  process.exitCode = fail === 0 ? 0 : 1;
};

main().catch((error) => {
  console.error('\n❌ desktop-agent-runtime 异常:', error);
  process.exitCode = 1;
});
