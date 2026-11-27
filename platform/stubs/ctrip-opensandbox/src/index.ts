/**
 * Local stub for `@ctrip/opensandbox`.
 *
 * The cloud sandbox is a remote code-execution service; there is no offline equivalent.
 * Keep `SANDBOX_ENABLED` unset so the `cloud-sandbox` builtin tool is never activated.
 * Constructing anything here throws so a misconfiguration surfaces immediately rather
 * than looking like a passing test.
 */

const unavailable = (what: string): never => {
  throw new SandboxException(
    `[stub] @ctrip/opensandbox ${what} is unavailable offline. ` +
      `Keep SANDBOX_ENABLED unset — the cloud-sandbox builtin tool cannot run locally.`,
  );
};

export class SandboxException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxException';
  }
}

export interface ExecutionHandlers {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  onResult?: (result: unknown) => void;
  onError?: (error: unknown) => void;
  [key: string]: unknown;
}

/**
 * 注意：这个类**故意不抛**。
 *
 * 群体编排路径（`aiAgent.execGroupAgent` → AgentToolsEngine）在组装工具集时会
 * **无条件**构造沙箱连接配置 —— `sandboxEnabled` 在 `AgentToolsEngine/index.ts:125`
 * 默认就是 `true`，并不看 `SANDBOX_*` 环境变量有没有设。
 *
 * 真实 SDK 的构造函数只是存配置、不建连接，要到实际调用才会失败；
 * 存根若在构造期就抛，就比真包更严格，会把整条群体编排路径堵死
 * （实测：`Failed to execute group agent: [stub] ConnectionConfig is unavailable offline`），
 * 从而把「离线不能跑云沙箱」误伤成「群体编排不可用」。
 *
 * 因此这里保持可构造，真正的执行入口（Sandbox / SandboxManager）仍然抛。
 */
export class ConnectionConfig {
  readonly options: Record<string, unknown>;

  constructor(options: Record<string, unknown> = {}) {
    this.options = options;
  }
}

export class Sandbox {
  constructor(_options: Record<string, unknown> = {}) {
    unavailable('Sandbox');
  }

  static async create(_options?: Record<string, unknown>): Promise<Sandbox> {
    return unavailable('Sandbox.create');
  }
}

export class SandboxManager {
  constructor(_options: Record<string, unknown> = {}) {
    unavailable('SandboxManager');
  }
}

export default { ConnectionConfig, Sandbox, SandboxException, SandboxManager };
