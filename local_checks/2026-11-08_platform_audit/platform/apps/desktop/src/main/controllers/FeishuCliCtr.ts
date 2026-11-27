import { existsSync } from 'node:fs';

import { FEISHU_LOGIN_SCOPES } from '@lobechat/feishu-auth-scopes';
import { shell } from 'electron';

import { larkCliBin } from '@/const/dir';
import { runLarkCli } from '@/modules/feishuCli/runLarkCli';
import { createLogger } from '@/utils/logger';

import { ControllerModule, IpcMethod } from './index';

const logger = createLogger('controllers:FeishuCliCtr');

/**
 * The Feishu app lark-cli is bound to. lark-cli is pointed at a desktop-private
 * HOME (see larkCliHome) so this config does not clobber any system-wide
 * lark-cli the user runs in their own terminal.
 *
 * ⚠️ 凭证**只从运行时环境变量读**，不再硬编码，也**不经 electron-vite 的 `define`
 * 注入**。
 *
 * 原先这里写死了 app_id / app_secret，注释的理由是「Web 端 bundle 里本来就有，
 * 所以这里再放一份不算新增暴露」。该前提已经不成立 —— Web 侧已改为服务端换票
 * （见 `src/services/feishuToken.ts`），前端产物里不再有密钥。
 *
 * 这里也不能用 `define` 在构建期内联：那等于把密钥烤进打包产物，
 * 用户解开 asar 就能拿到，和硬编码是同一个问题。改为运行时读取后，
 * 未提供凭证的安装包**不携带任何密钥**，飞书 CLI 功能保持关闭 ——
 * 这是安全的默认值：不向终端用户分发共享凭证。
 */
const CALCIFER_APP_ID = process.env.FEISHU_APP_ID;
const CALCIFER_APP_SECRET = process.env.FEISHU_APP_SECRET;

const requireFeishuCredentials = (): { appId: string; appSecret: string } => {
  if (!CALCIFER_APP_ID || !CALCIFER_APP_SECRET) {
    throw new Error(
      'Feishu CLI is not configured: set FEISHU_APP_ID and FEISHU_APP_SECRET in the desktop runtime environment',
    );
  }
  return { appId: CALCIFER_APP_ID, appSecret: CALCIFER_APP_SECRET };
};

/**
 * Exact scopes requested at login — the scopes the TripYoYo app is registered
 * for. Single source of truth shared with the web client lives in the zero-dep
 * leaf package `@lobechat/feishu-auth-scopes` (web reaches it via
 * `@lobechat/builtin-mcp-feishu`). Requesting scopes the app does NOT have (e.g.
 * `--domain all`) makes Feishu reject the authorization ("Your request has been
 * rejected").
 */
const LOGIN_SCOPE = FEISHU_LOGIN_SCOPES.join(' ');

/**
 * "查看授权详情" → the user-side Feishu authorization detail page in the Account
 * Security Center (shows what this app is authorized to do, with a revoke
 * button).
 *
 * NOTE: this page's `app_id` query param is Feishu's INTERNAL numeric
 * application id, NOT the OAuth app_id (`cli_…`). Passing the `cli_…` id renders
 * an empty/broken page. The numeric id is stable per app; for TripYoYo
 * (`cli_a8d81270b979900d`) it is `7517262511616376834`.
 */
const CALCIFER_APP_NUMERIC_ID = '7650419311391296490';
const AUTH_DETAIL_URL = `https://accounts.feishu.cn/accounts/security/page/apply_authorization/detail?app_id=${CALCIFER_APP_NUMERIC_ID}&auth_type=1`;

export interface FeishuCliStatus {
  bin: string;
  installed: boolean;
  version?: string;
}

export interface FeishuCliAuthStatus {
  appId?: string;
  brand?: string;
  loggedIn: boolean;
  openId?: string;
  raw?: string;
  unionId?: string;
}

export interface FeishuCliStartLoginResult {
  deviceCode?: string;
  error?: string;
  expiresIn?: number;
  userCode?: string;
  verificationUrl?: string;
}

export interface FeishuCliCompleteLoginResult {
  error?: string;
  success: boolean;
}

/**
 * Best-effort JSON parse of a lark-cli stdout payload (it emits a single JSON
 * object for these commands, sometimes with a trailing `_notice`).
 */
const parseJson = (stdout: string): any | undefined => {
  const text = stdout.trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        /* ignore */
      }
    }
    return undefined;
  }
};

/**
 * Feishu CLI Controller
 *
 * Exposes the bundled lark-cli (Feishu CLI) to the renderer: detect the binary,
 * report/drive the device-flow login, and open the Feishu authorization page.
 */
export default class FeishuCliCtr extends ControllerModule {
  static override readonly groupName = 'feishuCli';

  /**
   * Bind lark-cli to our app (idempotent). Writes app-id/secret/brand into the
   * desktop-private config so subsequent `auth login` / commands target it.
   */
  private async ensureAppConfigured(): Promise<void> {
    const { appId, appSecret } = requireFeishuCredentials();

    const { stdout } = await runLarkCli(['config', 'show'], { timeout: 10_000 });
    if (parseJson(stdout)?.appId !== appId) {
      await runLarkCli(
        ['config', 'init', '--app-id', appId, '--app-secret-stdin', '--brand', 'feishu'],
        { input: appSecret, timeout: 20_000 },
      );
    }

    // Lock this app to the USER identity only (disable bot). The bot identity
    // needs just app_id + secret (no user authorization), so without this it
    // stays usable even after the user logs out: `--as auto` silently falls back
    // to bot and keeps reading Feishu. Scoped to this app's config (no
    // `--global`), so it does not affect a system-wide lark-cli. Idempotent and
    // re-asserted every time, because `config init` does not set it and an older
    // config may have left it off.
    await runLarkCli(['config', 'strict-mode', 'user'], { timeout: 10_000 });
  }

  /**
   * Detect the bundled lark-cli and read its version.
   */
  @IpcMethod()
  async getStatus(): Promise<FeishuCliStatus> {
    if (!existsSync(larkCliBin)) {
      return { bin: larkCliBin, installed: false };
    }

    const { exitCode, stdout } = await runLarkCli(['--version']);
    return {
      bin: larkCliBin,
      installed: exitCode === 0,
      version: exitCode === 0 ? stdout.trim().split('\n')[0] : undefined,
    };
  }

  /**
   * Read the current login state via `lark-cli auth status` (local, no network).
   */
  @IpcMethod()
  async getAuthStatus(): Promise<FeishuCliAuthStatus> {
    await this.ensureAppConfigured();
    const { stdout } = await runLarkCli(['auth', 'status'], { timeout: 15_000 });
    const json = parseJson(stdout);
    const user = json?.identities?.user;
    return {
      appId: json?.appId,
      brand: json?.brand,
      loggedIn: user?.available === true,
      openId: user?.openId,
      raw: stdout,
      unionId: user?.unionId,
    };
  }

  /**
   * Begin device-flow authorization: request a device code, open the Feishu
   * verification page in the browser, and return the codes so the renderer can
   * show the URL / user code and then call `completeLogin`.
   *
   * `scopes` (optional): when a lark-cli command fails on a missing scope, the
   * in-conversation authorize card passes ONLY the scope(s) the failing command
   * named. lark-cli merges them into its locally-cached scope set (the full
   * baseline granted at install time), so requesting just the delta never drops
   * already-granted scopes, and Feishu's incremental consent shows the user only
   * the one new permission. When `scopes` is empty (token expired / not logged in
   * — no specific scope to top up), fall back to the full baseline `LOGIN_SCOPE`
   * so a fresh authorization re-establishes the whole set.
   */
  @IpcMethod()
  async startLogin({ scopes }: { scopes?: string[] } = {}): Promise<FeishuCliStartLoginResult> {
    await this.ensureAppConfigured();
    const scope = scopes && scopes.length > 0 ? scopes.join(' ') : LOGIN_SCOPE;
    const { stdout, stderr } = await runLarkCli(
      ['auth', 'login', '--no-wait', '--json', '--scope', scope],
      { timeout: 30_000 },
    );
    const json = parseJson(stdout);

    if (!json || json.error || !json.verification_url) {
      const message = json?.error?.message || stderr || stdout || 'failed to start login';
      logger.error(`startLogin failed: ${message}`);
      return { error: message };
    }

    const verificationUrl: string = json.verification_url;
    // The user code is embedded in the verification URL (…&user_code=XXXX-XXXX).
    let userCode: string | undefined;
    try {
      userCode = new URL(verificationUrl).searchParams.get('user_code') ?? undefined;
    } catch {
      /* ignore */
    }

    await shell.openExternal(verificationUrl);

    return {
      deviceCode: json.device_code,
      expiresIn: json.expires_in,
      userCode,
      verificationUrl,
    };
  }

  /**
   * Complete device-flow authorization. Call after the user has approved in the
   * browser; lark-cli exchanges the device code for a token stored in the OS
   * keychain.
   */
  @IpcMethod()
  async completeLogin({
    deviceCode,
    expiresIn,
  }: {
    deviceCode: string;
    expiresIn?: number;
  }): Promise<FeishuCliCompleteLoginResult> {
    // Without `--no-wait`, lark-cli blocks and polls Feishu's token endpoint
    // until the user approves in the browser (or the device code expires). Give
    // it the full device-code lifetime (+ buffer) so slow approvals are not cut
    // off; fall back to 120s when the caller did not pass `expiresIn`.
    const timeout = expiresIn ? expiresIn * 1000 + 10_000 : 120_000;
    const { exitCode, stdout, stderr } = await runLarkCli(
      ['auth', 'login', '--device-code', deviceCode, '--json'],
      { timeout },
    );
    const json = parseJson(stdout);

    if (exitCode === 0 && json && !json.error) {
      return { success: true };
    }
    const message = json?.error?.message || stderr || stdout || 'authorization failed';
    return { error: message, success: false };
  }

  /**
   * Log out (clear the user token).
   *
   * Clearing the user token is enough because the app is locked to the user
   * identity via `config strict-mode user` (see `ensureAppConfigured`): the bot
   * identity is disabled, so once the user token is gone there is no identity
   * left for `--as auto` to fall back to, and the AI can no longer reach Feishu.
   * (`config remove` would also work but is heavier — `ensureAppConfigured`
   * would just rebuild the app config on the next status check.)
   */
  @IpcMethod()
  async logout(): Promise<{ success: boolean }> {
    const { exitCode } = await runLarkCli(['auth', 'logout']);
    return { success: exitCode === 0 };
  }

  /**
   * Open the Feishu authorization details page in the user's browser.
   */
  @IpcMethod()
  async openAuthDetail(): Promise<void> {
    logger.debug(`Opening Feishu auth detail: ${AUTH_DETAIL_URL}`);
    await shell.openExternal(AUTH_DETAIL_URL);
  }
}
