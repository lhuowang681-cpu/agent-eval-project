# 阶段 4 · 完全离线启动手册

> 目标：在**不访问携程内网、运行期零出网**的条件下把项目跑起来并完成一次完整 agent 对话。
> 全部步骤实测于 Windows 11 + Node 24.19.0 + pnpm 10.33.4 + bun 1.3.14（2026-08-07）。
> 计划与决策依据见 [PLAN.md §4](../../PLAN.md)。

## 边界：「不联网」分两段

| 阶段 | 网络 | 内容 |
| --- | --- | --- |
| **P0 一次性准备** | 需**公网**（不需要内网） | 装工具链、`pnpm install`、Electron 二进制 |
| **P1 之后全部开发测试** | **可断网** | 全部走 `localhost` |

依赖树 4192 个包中仅 46 个指向 `artifactory.release.ctripcorp.com`，全是 `@ctrip/*`（8 直接 + 38 传递）。做掉 8 个存根，46 个全部消失。

---

## P0 一次性准备

### 1. 工具链（无需管理员）

`winget install OpenJS.NodeJS.LTS` 会因 MSI 需要管理员而失败（Error 1925）。用便携版：

```powershell
# 下载并校验（SHASUMS256 来自 nodejs.org）
Invoke-WebRequest "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip" -OutFile "$env:TEMP\node.zip"
Expand-Archive "$env:TEMP\node.zip" -DestinationPath "$env:LOCALAPPDATA\Programs"
Rename-Item "$env:LOCALAPPDATA\Programs\node-v24.19.0-win-x64" "nodejs"

# 只改 User 级 PATH，不动系统设置
$u = [Environment]::GetEnvironmentVariable('PATH','User')
[Environment]::SetEnvironmentVariable('PATH', "$u;$env:LOCALAPPDATA\Programs\nodejs", 'User')

corepack enable
corepack prepare pnpm@10.33.4 --activate
```

bun 的官方脚本在 PowerShell 里会被 curl 的 stderr 噎住（NativeCommandError），直接下 zip：

```powershell
Invoke-WebRequest "https://github.com/oven-sh/bun/releases/latest/download/bun-windows-x64.zip" -OutFile "$env:TEMP\bun.zip"
# 解压后把 bun.exe 放进 %USERPROFILE%\.bun\bin 并加入 User PATH
```

### 2. 存根就位（必须在 install 之前）

8 个存根已在 `stubs/`，通过 **`package.json` 的 `pnpm.overrides`** 生效。

> ⚠️ **不要写进 `pnpm-workspace.yaml` 的 `overrides`** —— 实测 pnpm 10.33.4 下 `package.json` 的 `pnpm.overrides` 优先级更高，一旦存在，workspace 文件里那份被**完全忽略**（`pnpm-lock.yaml` 的 overrides 段可验证）。仓库原有的 `react` / `drizzle-orm` / `swagger-client` 等 pin 也因此从未生效。

### 3. 安装

```bash
pnpm install
```

验收：安装日志与 `pnpm-lock.yaml` 中 `artifactory.release.ctripcorp.com` 出现次数均应为 **0**（原 46）。

### 4. PGlite 三件套

```bash
pnpm add -D -w @electric-sql/pglite@0.5.4 @electric-sql/pglite-socket@0.2.7 @electric-sql/pglite-pgvector@0.0.5
```

> 版本必须成对：`pglite-socket@0.2.7` peer 要求 `pglite@0.5.4`；仓库原有的 0.3.16 没有 `execProtocolRawStream`，会报错。0.5.x 起 pgvector 拆成独立包。

### 5. 桌面端（可选）

```bash
# apps/cli 与 apps/desktop 都不在根 workspace，各有独立 pnpm-workspace.yaml
cd apps/cli && pnpm install && pnpm run build && cd ../..
cd apps/desktop && pnpm install && cd ../..

# Electron 二进制根安装不会下载（根 workspace 的 onlyBuiltDependencies 不含 electron）
cd node_modules/.pnpm/electron@*/node_modules/electron && node install.js && cd -
```

---

## P1 断网后

### 6. 伪造桌面端外部二进制（不下载）

```bash
node scripts/local/setupOfflineMocks.mjs
```

伪造 OpenCLI 与 lark-cli 的完整目录布局，版本号对齐让原下载脚本的 skip-guard 短路。被调用时打印 `[stub]` 并非零退出 —— 失败要响，不静默。

### 7. 环境变量

```bash
cp .env.offline.example .env
```

关键项：

```bash
NODE_ENV=development
MOCK_DEV_USER_ID=offline-dev-user
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/postgres
DISABLE_REDIS=1
OPENAI_PROXY_URL=http://localhost:8088/v1
AGENTS_INDEX_URL=http://localhost:8089/local-index/agents.json
PLUGINS_INDEX_URL=http://localhost:8089/local-index/plugins.json
SEARXNG_URL=http://localhost:8089/search
S3_ACCESS_KEY_ID=offline-mock     # 必填！见下
S3_SECRET_ACCESS_KEY=offline-mock
S3_ENDPOINT=http://localhost:8089/s3
```

> **S3 是聊天主链路的硬依赖**，不是"测文件才需要"。`AiChatService` 构造时 eager 创建 `FileService → new S3()`，其构造函数校验三个值非空（`src/server/modules/S3/index.ts:45`）就抛错 —— 不填则 `sendMessageInServer` 直接 500。它不做连通性检查，占位值即可。

**必须保持不设**（设了就出网）：`AGENT_RUNTIME_MODE`、`ZXQSTASH_*`、`MARKET_*`、`SKILL_SECURITY_SCAN_*`、`*_GATEWAY_URL`、`SANDBOX_*`、`ENABLE_TELEMETRY*`、`NEXT_PUBLIC_SENTRY_DSN`、`CDN_USE_GLOBAL`，以及全部 analytics。完整清单见 `.env.offline.example`。

### 8. 代码改动点

`packages/business/const/src/llm.ts`：`DEFAULT_PROVIDER` / `DEFAULT_MINI_PROVIDER` 从 `'tripflow'` 改为 `'openai'`。

> tripflow 是携程内网网关，地址由已存根的 `@ctrip/peta-ai-client` 解析 —— 不改的话**第一次发消息就挂在网关解析上**。

### 9. 起服务

```bash
bun run tsx scripts/local/pgliteServer.ts      # :5432，自动跑 107 个 migration
bun run tsx tools/mock-llm/server.ts           # :8088，13 个场景
bun run tsx tools/mock-services/server.ts      # :8089，search/crawl/market/index
bun run tsx scripts/local/seedDevUser.ts       # 种子用户 + RBAC 引导
bun run dev:next                               # :3010
```

> **RBAC 必须引导**：迁移创建了 `rbac_roles`/`rbac_permissions`/`rbac_user_roles` 但**不写任何数据**，全新库上 `/api/v1` 每个权限门禁端点一律拒绝。`seedDevUser.ts` 会写入 119 条权限 + admin 角色并授予。

前端按需：

```bash
bun run dev:spa           # Web SPA :9876
bun run dev:spa:mobile    # :3012 —— 注意要访问 /index.mobile.html 才是真移动端入口
OFFICIAL_CLOUD_SERVER=http://localhost:3010 DEVICE_GATEWAY_URL=http://127.0.0.1:9 bun run dev:desktop
```

> **桌面端默认连线上**：它不读 `.env`，而是加载 `.env.desktop.test`（写死 `calcifer.train.ctripcorp.com`）。`dotenv.config()` 不覆盖已存在的 `process.env`，所以启动前设同名变量即可压过去，无需改仓库文件。

---

## 验收

```bash
bun run tsx tools/api-test/smoke.ts     # 27 项断言
```

| 检查点 | 期望 |
| --- | --- |
| `pnpm install` 无 artifactory 请求 | ✅ |
| PGlite 起来，107 migration / 110 表 / pgvector 可用 | ✅ |
| `GET /api/v1/health` | `{"status":"ok"}` |
| `GET /api/agent/run` | `{"healthy":true}` |
| tRPC `lambda.healthcheck` | `"i'm live!"` |
| 带 `lobe-auth-dev-backend-api: 1` 取 `/api/v1/users/me` | 返回种子用户 |
| 完整闭环 | SSE 收到 `agent_runtime_end`，`.agent-tracing/` 生成快照 |
| 零出网 | 见下 |

零出网核查（无需提权）：

```powershell
$ids = (Get-Process -Name node,bun,electron).Id
Get-NetTCPConnection -State Established |
  Where-Object { $ids -contains $_.OwningProcess -and $_.RemoteAddress -notlike '127.*' -and $_.RemoteAddress -ne '::1' }
# 期望：无输出
```

实测：80 秒采样期间跑完整套冒烟，非回环出站连接 **0 条**。

---

## 已知限制

| 项 | 说明 |
| --- | --- |
| ~~**无 Redis**~~ | 🔄 **2026-08-08 起已接入真 Redis** —— 步锁 / Stream / TTL 全部解封并通过；SSE 静默失效随之消除（条件：配上 `REDIS_URL`）。原文：步锁是空实现、Redis Stream 与 TTL 测不到；SSE 事件投递会因 Next.js dev 的 HMR 静默失效 |
| ~~**PGlite ≠ 真 Postgres**~~ | 🔄 **已换 `paradedb/paradedb:latest-pg17`** —— 109 条迁移全量应用、14 个 `USING bm25` 索引、并发梯度 1→50 错误率 0%。⚠️ 换 Docker 时**必须用 ParadeDB**：仓库 dev compose 的 `pgvector/pgvector:pg17` **同样不含 `pg_search`** |
| 云沙箱 / 飞书 / tripflow | 存根，调用即抛错 |
| 工作流 | qworkflow 存根为顺序执行，**无持久化、无重试、无并行** |
| 真实 token 成本 | Mock 的 usage 是构造的，只能验证累加逻辑 |

完整未验证清单见 [PLAN.md「待将来补测清单」](../../PLAN.md)。
