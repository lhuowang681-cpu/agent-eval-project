import { ensureElectronIpc } from '@/utils/electron/ipc';

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
 * Gate 机制:让 chatStore 的 tool 执行链在检测到 auth error 时挂起,
 * 等待用户在卡片里完成授权后继续。类似 web 的 feishuTokenService.waitForUserAuthorization。
 *
 * 按 key（默认 messageId）隔离,避免多个 topic / 多条消息同时触发授权时互相串扰
 * （否则模块级单例会让后来者直接复用前者的 promise,授权一次会让多处一起 resolve）。
 */
interface PendingAuthGate {
  promise: Promise<void>;
  reject: (error: Error) => void;
  resolve: () => void;
}

const DEFAULT_GATE_KEY = '__default__';
const pendingAuthGates = new Map<string, PendingAuthGate>();

/**
 * 挂起当前执行,等待用户完成飞书授权。
 * 在 chatStore 的 tool 执行链里调用,检测到 auth error 后 await 这个函数。
 * 传入 key（如 messageId）以隔离并发的多个授权请求。
 */
export const waitForFeishuCliAuth = (key: string = DEFAULT_GATE_KEY): Promise<void> => {
  const existing = pendingAuthGates.get(key);
  if (existing) return existing.promise;

  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  pendingAuthGates.set(key, { promise, reject, resolve });
  return promise;
};

/**
 * 用户完成授权后调用,resolve 所有 pending gate,让挂起的 tool 执行继续。
 * 授权是全局动作（一次登录覆盖所有挂起的请求）,因此放开所有 gate。
 */
export const onFeishuCliAuthComplete = (): void => {
  for (const gate of pendingAuthGates.values()) gate.resolve();
  pendingAuthGates.clear();
};

/**
 * 用户取消授权或授权失败后调用,reject 所有 pending gate。
 */
export const onFeishuCliAuthFailed = (error?: Error): void => {
  const err = error || new Error('Authorization failed');
  for (const gate of pendingAuthGates.values()) gate.reject(err);
  pendingAuthGates.clear();
};

/**
 * 鉴权类错误的关键字（用于子类型 / message / hint 兜底匹配，覆盖 token 过期、未登录、缺 scope）。
 */
const LARK_CLI_AUTH_KEYWORDS =
  /missing[\s_-]*(?:required[\s_-]*)?scope|auth[\s_-]*login|--scope|device[\s_-]*flow|unauthor|invalid[\s_-]*(?:access[\s_-]*)?token|token[\s_-]*(?:expired|invalid)|not[\s_-]*(?:logged[\s_-]*in|authorized)|需要(?:重新)?授权|重新授权|认证.*(?:过期|失效)|令牌.*(?:过期|失效)|未(?:登录|授权)/i;

/**
 * 判断一段 lark-cli 输出（execScript 工具结果）是否为鉴权类错误。命中时聊天里渲染 desktop 授权卡片。
 *
 * lark-cli 的错误信封形如 `{ "ok": false, "error": { "type": "authorization", "subtype": "missing_scope", ... } }`，
 * 但 token 过期 / 未登录等子类型的 type / message 不尽相同，因此除了认 `error.type === 'authorization'`，
 * 还放宽到 subtype / missing_scopes / hint / message 的关键字，并对非纯 JSON 的输出做关键字兜底。
 */
export const isLarkCliAuthError = (content?: string | null): boolean => {
  if (!content) return false;

  const tryParse = (text: string): any => {
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  };

  const trimmed = content.trim();
  let obj = tryParse(trimmed);
  if (!obj) {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) obj = tryParse(trimmed.slice(start, end + 1));
  }

  // 解析出标准失败信封：按 type / subtype / missing_scopes / hint / message 综合判定
  const err = obj?.ok === false ? obj.error : undefined;
  if (err) {
    if (err.type === 'authorization') return true;
    if (Array.isArray(err.missing_scopes) && err.missing_scopes.length > 0) return true;
    if (typeof err.subtype === 'string' && LARK_CLI_AUTH_KEYWORDS.test(err.subtype)) return true;
    if (LARK_CLI_AUTH_KEYWORDS.test(`${err.message ?? ''} ${err.hint ?? ''}`)) return true;
    return false;
  }

  // 非标准 JSON（被包了一层 / markdown 混排）：要同时出现「失败信封信号」和「鉴权字样」才兜底，
  // 避免成功抓回的文档正文里恰好含「授权 / token」等字样被误判。
  const looksLikeErrorEnvelope = /"ok"\s*:\s*false|"error"\s*:\s*[{"]/i.test(trimmed);
  return looksLikeErrorEnvelope && LARK_CLI_AUTH_KEYWORDS.test(trimmed);
};

/** scope 形如 `offline_access` / `im:chat:read` / `search:message`，用于过滤抽取时的杂串。 */
const SCOPE_TOKEN = /^[a-z][\w.:-]*$/i;

/**
 * 从 lark-cli 的鉴权错误输出里抠出「缺失的 scope」，用于按需补授：授权卡片只请求这几个 scope，
 * lark-cli 会把它们并入本地已缓存的基线 scope 集合，因此不顶掉已授权限，用户在飞书页也只看到
 * 这一条新权限。抽不到时返回空数组，调用方（startLogin）回退到全量基线授权。
 *
 * 两种来源都认：
 * - 结构化失败信封 `error.missing_scopes: string[]`；
 * - lark-cli 的提示串 `Run \`lark-cli auth login --scope "search:message"\``（`--scope` 后可能是
 *   单/双引号包裹或裸串，且可能是空格分隔的多个 scope）。
 */
export const extractLarkCliMissingScopes = (content?: string | null): string[] => {
  if (!content) return [];
  const scopes = new Set<string>();

  const trimmed = content.trim();
  let obj: any;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        obj = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        /* ignore */
      }
    }
  }
  const err = obj?.ok === false ? obj.error : undefined;
  if (Array.isArray(err?.missing_scopes)) {
    for (const s of err.missing_scopes) {
      if (typeof s === 'string' && SCOPE_TOKEN.test(s.trim())) scopes.add(s.trim());
    }
  }

  // 提示串里的 `--scope "a b"` / `--scope 'a'` / `--scope a`
  const re = /--scope\s+(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const raw = m[1] ?? m[2] ?? m[3] ?? '';
    for (const s of raw.split(/\s+/)) {
      if (SCOPE_TOKEN.test(s)) scopes.add(s);
    }
  }

  return [...scopes];
};

let lastSyncedOpenId: string | null = null;

/**
 * 把 lark-cli 报告的飞书身份（open_id/union_id）同步进当前用户，并刷新用户 store 让个人资料
 * 即时显示。按 openId 去重，避免每次轮询 getAuthStatus 都写库/刷新。失败不影响流程。
 */
const syncFeishuBinding = (status: FeishuCliAuthStatus): void => {
  if (!status.loggedIn || !status.openId || status.openId === lastSyncedOpenId) return;
  const openId = status.openId;
  import('@/services/user')
    .then(({ userService }) =>
      userService.updateFeishuBinding({
        feishuOpenId: openId,
        feishuUnionId: status.unionId ?? null,
      }),
    )
    .then(async (result) => {
      if (!result) return;
      lastSyncedOpenId = openId;
      const { useUserStore } = await import('@/store/user');
      await useUserStore.getState().refreshUserState();
    })
    .catch(() => {});
};

class FeishuCliService {
  /**
   * Detect the bundled lark-cli and read its version.
   */
  getStatus = async (): Promise<FeishuCliStatus> => {
    return ensureElectronIpc().feishuCli.getStatus();
  };

  /**
   * Read the current Feishu login state.
   */
  getAuthStatus = async (): Promise<FeishuCliAuthStatus> => {
    const status = await ensureElectronIpc().feishuCli.getAuthStatus();
    syncFeishuBinding(status);
    return status;
  };

  /**
   * Begin device-flow authorization (opens the Feishu verification page).
   *
   * `scopes`（可选）：缺 scope 触发的按需补授只传报错点名的那几个 scope，lark-cli 会并入本地
   * 缓存的基线集合（见 FeishuCliCtr.startLogin）。不传（如设置/onboarding 的全量授权、或 token
   * 过期兜底）则请求全量基线。
   */
  startLogin = async (scopes?: string[]): Promise<FeishuCliStartLoginResult> => {
    return ensureElectronIpc().feishuCli.startLogin({ scopes });
  };

  /**
   * Complete device-flow authorization. lark-cli blocks-polls Feishu until the
   * user approves in the browser, so this can be called right after startLogin
   * (no manual "I've authorized" step). Pass `expiresIn` to align the wait with
   * the device code's lifetime.
   */
  completeLogin = async (
    deviceCode: string,
    expiresIn?: number,
  ): Promise<FeishuCliCompleteLoginResult> => {
    const result = await ensureElectronIpc().feishuCli.completeLogin({ deviceCode, expiresIn });
    if (result.success) {
      ensureElectronIpc()
        .feishuCli.getAuthStatus()
        .then(syncFeishuBinding)
        .catch(() => {});
    }
    return result;
  };

  /**
   * Log out (clear the stored token).
   */
  logout = async (): Promise<{ success: boolean }> => {
    return ensureElectronIpc().feishuCli.logout();
  };

  /**
   * Open the Feishu authorization details page in the default browser.
   */
  openAuthDetail = async (): Promise<void> => {
    return ensureElectronIpc().feishuCli.openAuthDetail();
  };
}

export const feishuCliService = new FeishuCliService();
