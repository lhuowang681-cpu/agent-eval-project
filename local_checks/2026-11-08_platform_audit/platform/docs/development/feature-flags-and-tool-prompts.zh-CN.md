# Feature Flag 与工具 systemRole 的边界陷阱

> 一次排查记录：`FEATURE_FLAGS=-cloud_sandbox` 已禁用沙箱，Agent 仍回答「我有沙箱环境」。

## 现象

桌面端问 Agent「你有沙箱环境吗」，Agent 回答有，并列出能力：运行 Shell 命令、代码执行（Python/Node.js）、文件操作、安装依赖（pip/npm）。

追问「你怎么知道有沙箱」，Agent 自陈来源：

- `Skills` 工具描述里有 `runCommand` / `execScript` / `exportFile`
- `Tools Activator` 描述里提到了 `lobe-cloud-sandbox` 和 `injectCredsToSandbox`

## 根因

`cloud_sandbox` feature flag 只控制**工具挂载**，不删除其他工具 systemRole 里对该能力的描述。

### Flag 实际切的是「工具挂载」（4 处闸门）

| 位置                                           | 作用                                                         |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `src/store/tool/selectors/tool.ts:131`         | CloudSandbox 不进 `<available_tools>` 发现列表               |
| `src/helpers/toolEngineering/index.ts:157-160` | rules 里 `cloudSandboxAvailable && ...` 为 false，不挂载工具 |
| `src/server/services/aiAgent/index.ts:548-556` | sandbox-bound 执行计划降级为 `none`                          |
| `src/server/routers/tools/market.ts:159`       | 硬执行闸门，拒绝调用                                         |

### 但管不到的是 Tools Activator 的静态 systemRole

`packages/builtin-tool-activator/src/systemRole.ts` 的 `systemPrompt` 是一段**静态字符串**，硬编码多处提及 `lobe-cloud-sandbox` / `injectCredsToSandbox` / `runCommand`（L46 / L74 / L82 / L86 / L90-94）。这段提示词无论 flag 开关都会原样注入 LLM system prompt。

代码注释多处声称「flag 关后 LLM 永远看不到沙箱引导、不会误调用」—— 那只对 `lobe-cloud-sandbox` 工具**自己的** systemRole 成立。Tools Activator 是**另一份**静态 systemRole，绕过了这个保证。所以 flag 一关、沙箱工具确实摘了，但 Tools Activator 的提示词仍在告诉 LLM「你有 cloud sandbox 可用」，LLM 自然得出「我有沙箱环境」。

## 已落地修复（方案 2：守卫语，2026-07-01）

在 `packages/builtin-tool-activator/src/systemRole.ts` 末尾新增 `<sandbox_availability_guard>` section，约束 LLM：

- 唯一真相源是 `<available_tools>` 列表里是否列出 `lobe-cloud-sandbox`，而不是本提示词里提到过 sandbox 字眼。
- 列出 → 可用 `injectCredsToSandbox`；未列出 → 不得声称有沙箱、不得承诺在沙箱里跑代码、不得提 `injectCredsToSandbox`，credentials 走 `getPlaintextCred` 内联方式。
- 用户问「有没有沙箱」时按 `<available_tools>` 实情回答。

这是治标，靠 LLM 自觉。若后续仍偶发误称，升级为方案 1：把 `systemPrompt` 改成接收 `cloudSandboxAvailable` 参数的函数，flag 关时动态删掉对应段落（需让 manifest 注入时拿到 `serverFeatureFlags(userId).enableCloudSandbox`）。

## 排查路径（通用）

遇到「禁用某 feature flag 但 Agent 仍声称有该能力」时：

1. 第一时间怀疑**另一个工具的 systemRole 硬编码了该能力描述**—— 去 `packages/builtin-*` 各包的 `src/systemRole.ts` 里 grep 能力关键词。
2. 确认 flag 是否真正生效到 server 进程：
   - 改完 env 有没有重启 Next.js server？`process.env.FEATURE_FLAGS` 是进程启动时读的。
   - 放对 env 文件了吗？Web 端读 `.env`，桌面端读 `.env.desktop.*`，两类不互通。
   - EdgeConfig 是否启用？`getServerFeatureFlagsFromEdgeConfig`（`src/config/featureFlags/index.ts:57`）在 EdgeConfig 启用且返回非空时用 `merge(DEFAULT_FEATURE_FLAGS, edgeFeatureFlags)`—— 和默认值 merge，**不是和 env merge**。`DEFAULT_FEATURE_FLAGS.cloud_sandbox = true`（`src/config/featureFlags/schema.ts:85`），若 EdgeConfig 里没显式给 `cloud_sandbox`，env 的 `-cloud_sandbox` 会被无视。
3. 桌面端默认连远程 `OFFICIAL_CLOUD_SERVER`（`apps/desktop/src/main/env.ts:90-93`，默认 `https://calcifer.train.ctripcorp.com`）。Agent 对话和 featureFlags 判断都发生在远程服务进程，本地 env 管不到远程 —— 要在远程服务侧改 env 并重新部署。

## 相关代码

- `src/config/featureFlags/schema.ts` — flag schema、默认值、`mapFeatureFlagsEnvToState`
- `src/config/featureFlags/utils/parser.ts` — `-cloud_sandbox` 解析为 `false`
- `src/config/featureFlags/index.ts` — env 与 EdgeConfig 两条读取路径
- `packages/builtin-tool-activator/src/systemRole.ts` — 硬编码沙箱描述的静态 systemRole（含守卫语）
- `src/store/tool/selectors/tool.ts:119-136` — CloudSandbox 发现过滤
- `src/helpers/toolEngineering/index.ts:118-160` — CloudSandbox 挂载 rules
