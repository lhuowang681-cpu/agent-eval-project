#!/usr/bin/env node
/**
 * 桌面端 local-system 读写验证 —— PLAN.md 检查点 13 的未验证部分（F16.4 / F5.8）.
 *
 * 旧主机把这一项记为「❌ 未验证 —— 无法从当前会话驱动独立的 Electron 应用窗口；
 * 需人工操作或引入 Playwright 的 Electron 驱动」。这里就是那个 Electron 驱动。
 *
 * 做法：用 `playwright._electron.launch()` 起主进程，然后在**渲染进程里**
 * 通过 preload 暴露的 IPC 调用 `LocalFileCtr` 的方法（writeFile / readFile /
 * listLocalFiles / grepContent / globFiles / editFile），对一个临时目录做真实读写，
 * 再用 Node 侧 fs 交叉校验落盘结果。
 *
 * 为什么不走 agent 对话：驱动富文本编辑器发消息本身就是旧主机卡住的地方，
 * 而本项要验证的是「local-system 能否真的读写本地文件」，IPC 层是更直接、
 * 也更不容易被 UI 细节干扰的观测点。
 *
 * ⚠️ 离线要求：桌面端 dev 默认加载 .env.desktop.test，其中 OFFICIAL_CLOUD_SERVER
 * 与 DEVICE_GATEWAY_URL 写死指向携程线上（PLAN.md 已记录）。本脚本启动前会覆盖它们。
 *
 * Usage:  node tools/api-test/desktop-local-system.mjs
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const DESKTOP = join(ROOT, 'apps', 'desktop');

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
  console.info('桌面端 local-system 读写 — 检查点 13 / F16.4 / F5.8');
  console.info('═'.repeat(66));

  // 强制离线：dotenv 不覆盖已存在的 process.env，所以这里设了就能压过
  // .env.desktop.test 里写死的线上地址。
  process.env.OFFICIAL_CLOUD_SERVER = 'http://localhost:3010';
  process.env.DEVICE_GATEWAY_URL = 'http://127.0.0.1:9';
  process.env.NODE_ENV = 'development';

  // playwright 没有被 hoist 到根 node_modules（pnpm 隔离），也不是本文件的依赖，
  // 所以裸 `import('playwright')` 会 ERR_MODULE_NOT_FOUND。用 createRequire 从
  // .pnpm store 里按 CJS 入口加载。
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  const pwPath = join(
    ROOT,
    'node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js',
  );
  const { _electron: electron } = require(pwPath);

  const mainEntry = join(DESKTOP, 'dist', 'main', 'index.js');
  check('主进程构建产物存在', existsSync(mainEntry), mainEntry);
  if (!existsSync(mainEntry)) {
    console.error('\n需要先构建桌面端主进程：cd apps/desktop && pnpm run build\n');
    process.exitCode = 1;
    return;
  }

  const workdir = mkdtempSync(join(tmpdir(), 'lobe-localsystem-'));
  console.info(`\n  临时工作目录: ${workdir}`);

  let app;
  try {
    // Playwright 默认从 cwd 的 node_modules 解析 electron；本仓库的 electron 只装在
    // apps/desktop/node_modules 下（它有独立的 pnpm-workspace），所以必须显式指路，
    // 否则报 "Electron failed to install correctly"。
    const electronExe = join(DESKTOP, 'node_modules', 'electron', 'dist', 'electron.exe');
    check('Electron 二进制存在', existsSync(electronExe), electronExe);

    app = await electron.launch({
      args: ['.'],
      cwd: DESKTOP,
      env: { ...process.env },
      executablePath: electronExe,
      timeout: 180_000,
    });
    check('Electron 应用启动', true, 'playwright._electron.launch 成功');
  } catch (error) {
    check('Electron 应用启动', false, String(error).slice(0, 220));
    rmSync(workdir, { force: true, recursive: true });
    process.exitCode = 1;
    return;
  }

  try {
    // 走**真实路径**：渲染进程 → preload 暴露的 `window.electronAPI.invoke`
    // → ipcRenderer.invoke(channel) → 主进程 IpcMethod 注册的 handler。
    //
    // channel 不是裸方法名，而是 `${groupName}.${methodName}`
    // （apps/desktop/src/main/utils/ipc/base.ts:106），LocalFileCtr 的
    // groupName 是 `localSystem`（LocalFileCtr.ts:57）。
    // 直接用方法名会得到 "No handler registered for 'handleWriteFile'"。
    const win = await app.firstWindow({ timeout: 120_000 });

    // 启动期渲染进程还会跳几次路由（onboarding → 主界面），执行上下文会被销毁。
    // 先等到网络空闲，再轮询确认 preload 的桥已挂上，否则 evaluate 会撞上
    // "Execution context was destroyed"。
    await win.waitForLoadState('networkidle', { timeout: 60_000 }).catch(() => {});

    let bridged = false;
    for (let i = 0; i < 30; i++) {
      try {
        bridged = await win.evaluate(() => typeof window.electronAPI?.invoke === 'function');
        if (bridged) break;
      } catch {
        /* 导航中，重试 */
      }
      await new Promise((r) => setTimeout(r, 1000));
    }

    check('渲染窗口就绪', !!win, await win.title().catch(() => '(无标题)'));
    check('preload 暴露了 electronAPI.invoke', bridged, String(bridged));

    if (!bridged) {
      console.error('\n  preload 桥未就绪，后续 IPC 断言无法进行。\n');
      return;
    }

    const GROUP = 'localSystem';
    const invoke = async (method, params) =>
      win.evaluate(
        async ({ method: m, params: p }) => {
          try {
            return await window.electronAPI.invoke(m, p);
          } catch (e) {
            return { __err: String(e) };
          }
        },
        { method: `${GROUP}.${method}`, params },
      );

    console.info('\n▶ 写入');
    const target = join(workdir, 'hello.txt');
    const content = 'local-system 写入验证\nline2\n';
    const w = await invoke('handleWriteFile', { content, cwd: workdir, path: target });

    if (w?.__err) {
      check('handleWriteFile 可调用', false, w.__err.slice(0, 200));
      console.info(
        '\n  说明：无法从主进程拿到 controller 实例，属驱动方式问题。' +
          '\n  下面改用「渲染进程 + preload IPC」再试一次。',
      );
    } else {
      check('handleWriteFile 可调用', true, JSON.stringify(w).slice(0, 120));
    }

    // Node 侧交叉校验：文件真的落盘了吗
    const landed = existsSync(target);
    check('文件真实落盘（Node fs 交叉校验）', landed, landed ? target : '未找到文件');
    if (landed) {
      const onDisk = readFileSync(target, 'utf8');
      check('落盘内容与写入一致', onDisk === content, `${onDisk.length} 字符`);
    }

    console.info('\n▶ 读取');
    const r = await invoke('readFile', { path: target });
    check(
      'readFile 读回内容',
      !r?.__err && JSON.stringify(r).includes('local-system'),
      r?.__err ? r.__err.slice(0, 160) : JSON.stringify(r).slice(0, 140),
    );

    console.info('\n▶ 列目录');
    writeFileSync(join(workdir, 'another.md'), '# another\n', 'utf8');
    // 返回的是 { files, totalCount }，不是裸数组（LocalFileCtr.ts:221-223）
    const ls = await invoke('listLocalFiles', { path: workdir });
    check(
      'listLocalFiles 列出两个文件',
      !ls?.__err && Array.isArray(ls?.files) && ls.files.length >= 2,
      ls?.__err ? ls.__err.slice(0, 160) : `totalCount=${ls?.totalCount} files=${ls?.files?.length}`,
    );

    console.info('\n▶ 内容检索');
    // 参数名是 `pattern`，不是 `query`（GrepContentParams，localSystem.ts:242+）
    // 两种 output_mode 都试：用来区分「findstr 没执行成功」还是「结果解析错了」。
    for (const mode of ['files_with_matches', 'content']) {
      const g = await invoke('handleGrepContent', {
        '-n': true,
        'output_mode': mode,
        'path': workdir,
        'pattern': 'line2',
      });
      const hit = !g?.__err && (g?.total_matches > 0 || JSON.stringify(g ?? {}).includes('hello'));
      check(
        `handleGrepContent 命中（output_mode=${mode}）`,
        hit,
        g?.__err ? g.__err.slice(0, 160) : JSON.stringify(g).slice(0, 160),
      );
    }
    console.info(
      '\n    对照：同一目录下手工执行产品实际拼出的命令' +
        '\n    `cmd /c findstr /S /R "line2" *.*` → 命中 `hello.txt:line2`，exitCode=0。' +
        '\n    若上面两种模式都为 0，则问题出在 Electron 侧的调用/解析，而非 findstr 本身。',
    );

    console.info('\n▶ 离线合规');
    const conns = await app.evaluate(async () => {
      // 主进程视角看有没有非回环出站（粗查：只看 app 自己发起的 http(s) 模块调用不现实，
      // 这里退而记录配置项，真正的连接审计由外部 Get-NetTCPConnection 做）
      return {
        cloud: process.env.OFFICIAL_CLOUD_SERVER,
        gateway: process.env.DEVICE_GATEWAY_URL,
      };
    });
    check(
      'OFFICIAL_CLOUD_SERVER 已被覆盖为本地',
      String(conns.cloud).includes('localhost'),
      String(conns.cloud),
    );
    check(
      'DEVICE_GATEWAY_URL 已被覆盖为死端口',
      String(conns.gateway).includes('127.0.0.1:9'),
      String(conns.gateway),
    );
  } finally {
    await app.close().catch(() => {});
    rmSync(workdir, { force: true, recursive: true });
  }

  console.info('\n' + '─'.repeat(60));
  console.info(`通过 ${pass} / 失败 ${fail}`);
  console.info('─'.repeat(60) + '\n');
  process.exitCode = fail === 0 ? 0 : 1;
};

main().catch((error) => {
  console.error('\n❌ desktop-local-system 异常:', error);
  process.exitCode = 1;
});
