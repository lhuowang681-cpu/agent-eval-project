# `@ctrip/*` 私有包本地存根

这些包只发布在 `artifactory.release.ctripcorp.com`（携程内网 Artifactory），公网无法安装。
本目录提供最小可用存根，让项目在**不访问携程内网**、**完全离线**的条件下也能 `pnpm install` 并运行。

对应计划：[PLAN.md 阶段 4.2](../PLAN.md)

## 为什么必须存根 `vampire-core`（而不是"能装就装"）

这个仓库把 npm 的 `debug` 包整体劫持了（`package.json` 里 `"debug": "workspace:*"` → `packages/debug`），
该包**强制开启 `lobe-*` 命名空间**（无视 `DEBUG` 环境变量，无关闭开关），并把每条日志转发给 `triplog`。

而 agent 运行时打的是**内容级日志** —— `RuntimeExecutors.ts:572-580` 会打印完整思维链、完整 LLM 回复、
完整工具调用参数。加上显式上报的 uid / model / provider 和 `AppID: 100071558`，实际外送的数据面很大。

`@ctrip/vampire-core` 不在公网、无法审计其真实传输行为，因此对"数据不出本机"的诉求，
**唯一可靠做法是不安装、直接存根**。存根后 `debug` 的原始 stderr 输出完整保留，本地调试体验无损失。

## 启用方式

在 **`package.json` 的 `pnpm.overrides`** 中把这 8 个包指向本目录：

> ⚠️ **不要写进 `pnpm-workspace.yaml` 的 `overrides`** —— 实测（pnpm 10.33.4）`package.json` 的 `pnpm.overrides` 优先级更高，一旦它存在，workspace 文件里的 overrides 会被完全忽略（`pnpm-lock.yaml` 的 overrides 段可验证）。

```json
"pnpm": {
  "overrides": {
    "dayjs": "1.11.19",
    "@ctrip/vampire-core": "link:./stubs/ctrip-vampire-core",
    "@ctrip/qstash": "link:./stubs/ctrip-qstash",
    "@ctrip/qworkflow": "link:./stubs/ctrip-qworkflow",
    "@ctrip/opensandbox": "link:./stubs/ctrip-opensandbox",
    "@ctrip/peta-ai-client": "link:./stubs/ctrip-peta-ai-client",
    "@ctrip/lark-auth": "link:./stubs/ctrip-lark-auth",
    "@ctrip/qshared": "link:./stubs/ctrip-qshared",
    "@ctrip/vampire-schedule": "link:./stubs/ctrip-vampire-schedule"
  }
}
```

**必须在 `pnpm install` 之前配好**，否则 pnpm 仍会去 artifactory 拉包。

恢复线上依赖：删掉上面 8 条 `@ctrip/*`（保留 `dayjs`）。

替换这 8 个直接依赖会连带消除 38 个传递依赖（`node-vampire-cache-prebuild*` ×24、
`node-vampire-locker-prebuild*` ×6、`vampire-artemis`/`-common`/`-dubbo`/`-request`/
`-runtime-context`/`-process-worker`、`apache-dubbo-js`、`foundation-framework`、`log` 等），
依赖树中指向 artifactory 的 46 个 resolution 全部清零。

## 各存根的行为与代价

| 包 | 存根行为 | 失去的能力 |
| --- | --- | --- |
| `vampire-core` | 全部 no-op；`triplog` 可选转 `console`（`STUB_TRIPLOG_CONSOLE=1`） | 携程 APM 上报 |
| `qstash` | `publishJSON` 抛错（本地应走 `LocalQueueServiceImpl`）；`Receiver.verify` 返回 `false` | 生产队列模式 |
| `qworkflow` | `serve` 降级为顺序执行、`context.run` 直接调用 | **持久化、重试、并行** |
| `opensandbox` | 构造即抛错 | 云沙箱代码执行（`cloud-sandbox` 14 个 API） |
| `peta-ai-client` | 抛错 | `tripflow` / `ztrip` provider |
| `lark-auth` | no-op，token 相关方法抛错 | 飞书登录 |
| `qshared` | 空包（代码零直接引用） | 无 |
| `vampire-schedule` | 空包（代码零直接引用） | 无 |

## 存根的自我保护

除 `vampire-core` / `qshared` / `vampire-schedule` 外，其余存根在被真正调用时**主动抛错**而不是静默返回，
避免"以为测过了、其实走的是空实现"。错误信息统一以 `[stub]` 开头，便于在日志里一眼识别。
