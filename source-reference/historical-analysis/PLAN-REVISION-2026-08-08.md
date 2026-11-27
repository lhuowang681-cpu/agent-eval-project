# PLAN.md 环境重估（新主机 · 2026-08-08）

> 对象：`codinganalysis/plan/PLAN.md`（原编写日期 2026-08-06/07，旧主机）
> 本机：`DESKTOP-V9NSHHJ\independent` · Windows 11 Home China 10.0.26100 · 20 逻辑核 / 31.7 GB RAM
> 代码：`codinganalysis/lobehub/`
> 本文只做**环境重估**，不改动原结论中与环境无关的部分（附录 B 循环失控、附录 C HIL 失效等代码级缺陷全部仍然成立）。

---

## 0. 先说最要紧的一条：阶段 4 的产物没有落进仓库

`codinganalysis/lobehub/` 是一份**干净的上游 checkout**，阶段 4 的离线改造一样都不在里面：

| 检查项 | 状态 |
| --- | --- |
| `node_modules/` | ❌ 不存在 |
| `.env` / `.env.offline.example` | ❌ 不存在 |
| `stubs/`（8 个 `@ctrip/*` 存根） | ❌ 不存在 |
| `tools/mock-llm/`、`tools/mock-services/`、`tools/api-test/` | ❌ 不存在 |
| `scripts/local/*` | ❌ 不存在 |
| `bench/`、`docs/analysis/`、`REPORT.*.md` | ❌ 不存在 |
| `package.json` → `pnpm.overrides` | 只有 `{"dayjs":"1.11.19"}` —— 8 条 `link:./stubs/*` **不在** |

产物全部躺在 `codinganalysis/plan/` 下（`stubs/`、`tools/`、`bench/`、`scripts/local/`、`docs/`、`reports/`、`.env.offline.example`），是一份交付包而非工作副本。

**结论**：阶段 4 需要重新落地，但属于「复制 + 接线」级别，不是重做。原 `PLAN.md` §4.8 的执行步骤依然适用，只是要先把 `plan/` 下的目录复制进 `lobehub/`，并把 8 条 override 写回 `package.json`（**必须写在 `package.json` 的 `pnpm.overrides`，不能写 `pnpm-workspace.yaml`** —— 原文档记录的头号坑）。

---

## 1. 环境实测对照

| 能力 | PLAN.md 记录（旧主机） | 本机实测（2026-08-08） | 结论 |
| --- | --- | --- | --- |
| Node.js | ❌ 未安装，靠用户目录便携版 | ✅ **v24.11.1**，`D:\Program Files\nodejs` | 满足 `.nvmrc`/`mise.toml` 的 node 24 |
| bun | ❌ 未安装 | ✅ **1.3.14**（winget 装的） | 直接可用 |
| pnpm | ❌ 未安装 | ⚠️ 未安装，但 **corepack 在** | 一条命令解决 |
| npm | — | ✅ 11.6.2 | — |
| git | — | ✅ 2.42.0 | 但 `lobehub/` 未初始化为 git 仓库 |
| **Docker** | ❌ **不能安装**（决策 8） | ✅ **已安装**（`C:\Program Files\Docker`），`com.docker.service` 为 Manual/Stopped，Docker Desktop 曾运行过 | **决策 8 前提消失** |
| **WSL** | ❌ **不能安装**（决策 8） | ✅ **Ubuntu 24.04.4 LTS 已装**（WSL2），能上网（`registry.npmjs.org` → 200），`sudo` 需密码 | **决策 8 前提消失** |
| **Redis** | ❌ **完全不可用**（决策 8） | ✅ **正在运行** —— Windows 原生 `Redis` 服务（Automatic/Running），`redis-cli ping` → `PONG`，`redis_version:5.0.14.1`，`127.0.0.1:6379` 监听中 | **最大解封项** |
| PostgreSQL | ❌ 无 → 降级 PGlite | ⚠️ 本机无原生安装，但 Docker / WSL 两条路都通 | 可升级到真 PG |
| 提权 | ❌ 非交互会话无法过 UAC | ⚠️ 同样非提权（`IsAdmin: False`），但账户**同时在 `Administrators` 和 `docker-users` 组** | 用户手动点一次即可 |
| 硬件 | — | 20 逻辑核 / 31.7 GB RAM / D 盘 88.4 GB 空闲 | **足以支撑原计划的 1→50 并发梯度** |
| 网络 | 物理断网 | ⚠️ **系统代理开启**：`ProxyEnable=1`，`ProxyServer=127.0.0.1:7897`，进程 `com.vortex.helper` (PID 24820) | **新增风险，见 §4.2** |
| 私有 registry | 不可达 | ✅ 仍不可达（`artifactory.release.ctripcorp.com` 连接失败） | 存根方案依然必需 |
| 公网 npm | P0 需要 | ✅ `registry.npmjs.org` 200、`registry.npmmirror.com` 200 | P0 可执行 |

---

## 2. 决策 8 应当作废，但**不是「插上 Redis 就全好了」**

原文档决策 8 是「本机不能安装 Docker 与 WSL」，由此导出「PGlite + 无 Redis」以及 8 项待补测。本机三个前提（Docker / WSL / Redis）全部不成立，**决策 8 整节作废**。

但重读 `src/server/modules/AgentRuntime/factory.ts` 后有一个必须澄清的细节 —— 原 PLAN.md 对它的描述过于笼统：

```ts
// createAgentStateManager()
if (!isQueueModeEnabled()) return inMemoryAgentStateManager;   // 非 queue 模式无条件 InMemory，根本不看 Redis
if (!isRedisAvailable()) throw ...
return new AgentStateManager();

// createStreamEventManager()
if (isRedisAvailable()) return new StreamEventManager();       // 只要 Redis 在，就用 Redis Stream，不看 queue 模式
if (!isQueueModeEnabled()) return inMemoryStreamEventManager;
throw ...
```

两个 manager 的判定条件**不一样**：

| | 触发条件 | 本机默认（Redis 在、`AGENT_RUNTIME_MODE` 不设） |
| --- | --- | --- |
| `StreamEventManager` | **Redis 可用即用 Redis** | ✅ 走 Redis Stream |
| `AgentStateManager` | **必须 `AGENT_RUNTIME_MODE=queue`** | ❌ 仍是 `InMemoryAgentStateManager` |

**直接后果**：

- **只要把 `REDIS_URL` 配上（并去掉 `DISABLE_REDIS`），附录 A.3 里那条 🔴「本地模式下 SSE 事件投递静默失效」立刻消失** —— 事件总线换成跨模块实例的 Redis Stream，不再受 Next.js dev HMR 影响。这是零成本的收益，本机应当默认开启。
- 但 **步锁、state TTL、pipeline 批写这三项仍然测不到**，因为它们全在 `AgentStateManager` 里，而它只在 queue 模式下才被创建。`InMemoryAgentStateManager.tryClaimStep()` 依旧是 `return true` 的空实现。

### 要解封步锁，得让 queue 模式在本地跑起来

`createQueueServiceModule()`（`src/server/services/queue/impls/index.ts:23-35`）在 queue 模式下强制要求 `ZXQSTASH_TOKEN` 并构造 `QStashQueueServiceImpl`，而后者调用 `@ctrip/qstash` 的 `publishJSON({url, body, delay, headers, retries})` 把消息投递到 `${AGENT_RUNTIME_BASE_URL}/api/agent/run`。

当前存根（`plan/stubs/ctrip-qstash/src/index.ts`）的 `publishJSON` 是**直接抛错**、`Receiver.verify` **返回 false**，所以 queue 模式跑不起来。

**建议改造：把 qstash 存根从「抛错」升级为「本地 QStash 模拟器」**，约 60 行：

- `publishJSON` → `setTimeout(delay*1000)` 后对 `url` 发一次真实的本地 `fetch` POST，带上原 headers，并用 `ZXQSTASH_CURRENT_SIGNING_KEY` 算一个真 HMAC-SHA256 填进 `X-ZxQstash-Signature`
- `Receiver.verify` → 做**真实**的 HMAC 校验，而不是无脑 `true`

这么做的价值不止是解封步锁：

1. `verifyQStashSignature`（`src/libs/qstash/index.ts:65-90`）的 fail-closed 路径变成**可测**的，而不是被绕过 —— 原计划里 F2.2 的 401 分支一直没真正验证过
2. 每一步变成**真实的独立 HTTP 请求**，而不是同进程 `setTimeout` 回调 —— 这才是生产的调度形态，步间调度延迟、429/`Retry-After: 37` 重投、并发重入才有意义
3. `assertPublicDeliveryUrl` 对 `NODE_ENV=development` 放行 localhost（`libs/qstash/index.ts:127`），本地投递不会被拦

---

## 3. 「待将来补测清单」8 项逐条重估

| # | 项 | 原判定 | 本机重估 | 解封条件 |
| --- | --- | --- | --- | --- |
| 1 | **步锁 / 并发重入保护**（F2.4 P0） | 测不了 | 🟢 **可解封** | Redis（已有）+ `AGENT_RUNTIME_MODE=queue` + 升级版 qstash 存根 |
| 2 | Redis Stream 事件总线 | 测不了 | 🟢 **已具备，零成本** | 只需配 `REDIS_URL` |
| 3 | state 2h TTL 过期与清理 | 测不了 | 🟢 **可解封** | 同 #1（TTL 在 `AgentStateManager.setex`） |
| 4 | `saveStepResult` 的 Redis pipeline 批写 | 测不了 | 🟢 **可解封** | 同 #1 |
| 5 | O(N²) 写放大 | ✅ 已完成 | 不变（与介质无关） | — |
| 6 | **BM25 全文检索** | 测不了（PGlite 跳过 `pg_search`） | 🟡 **有条件解封 —— 但不是用 dev compose**，见 §4.1 | Docker + **`paradedb/paradedb:latest-pg17`** 镜像 |
| 7 | 并发吞吐 / 错误率 / 吞吐拐点 / 连接池 | 测不了（PGlite 串行化） | 🟢 **可解封** | 真 PG（Docker 或 WSL）+ Redis；20 核 / 31.7 GB 足够跑到 50 并发 |
| 8 | Redis 不可用时的降级与故障表现 | 测不了 | 🟢 **可解封** | 有真 Redis 才能构造故障（停服务 / 断连 / 打满内存） |

另外两项「受测试手段限制」的（移动端 UI 对话、桌面端 `local-system`）**与主机环境无关**，本机同样受限 —— 除非引入 Playwright 驱动 Vite 页面、以及用 Playwright 的 Electron driver 接管桌面端窗口。这两条属于测试工具选型问题，不是环境问题，不要错误地归到「新主机解封」里。

---

## 4. 重读代码后发现的、PLAN.md 需要修正的技术判断

### 4.1 🔴 dev 的 docker-compose 没有 `pg_search`，起了 Docker 也测不了 BM25

`PLAN.md` §4.3.1 与 §4.0 都把 Docker 方案写成拉 `pgvector/pgvector:pg17`。实际上：

| compose 文件 | Postgres 镜像 | 含 `pg_search`？ |
| --- | --- | --- |
| `docker-compose/dev/docker-compose.yml`（`bun run dev:docker` 用的） | `pgvector/pgvector:pg17` | ❌ **没有** |
| `docker-compose/deploy/docker-compose.yml` | **`paradedb/paradedb:latest-pg17`** | ✅ 有 |

而 `packages/database/migrations/0090_enable_pg_search.sql` 就是一句 `CREATE EXTENSION IF NOT EXISTS pg_search;`，`0093_add_bm25_indexes_with_icu.sql` 建的是 `USING bm25 (...)` 索引，代码里 `message.ts` / `topic.ts` / `session.ts` / `userMemory/*` 共十余处用 `@@@` 操作符。

**所以：直接 `bun run dev:docker` 拿到的仍然是一个没有 BM25 的库**，待补测 #6 依然测不了，只是失败原因从「PGlite 不支持」变成「dev 镜像里没这个扩展」。要覆盖 BM25，必须把 dev compose 的 postgres 镜像换成 `paradedb/paradedb:latest-pg17`（它自带 pgvector，可平替）。

这一条原文档完全没有记录，属于新发现。

### 4.2 🔴 系统代理在跑，PLAN.md 的「零出网」验证方法在本机会产生假阴性

原检查点 14 的方法是：枚举 node / bun / electron 共 22 个 PID 的 `Get-NetTCPConnection -State Established`，收集 `RemoteAddress` 非 `127.*` 且非 `::1` 的连接，结论「非回环出站连接 0 条」。

本机 `ProxyEnable=1`、`ProxyServer=127.0.0.1:7897`，代理进程是 `com.vortex.helper`（PID 24820，监听 `::7897`）。在这种拓扑下：

- 应用进程真的出网时，它建立的连接是到 **`127.0.0.1:7897`** —— 按原判据会被当作「回环、安全」
- 真正的外部连接由 `com.vortex.helper` 建立，而它**不在被监控的 PID 列表里**

**原方法在本机直接失效**。修正做法（按强度递增）：

1. 起服务前先关掉系统代理，并确认 `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY` 环境变量未设（Node 24 的 `fetch` 会读 `NODE_USE_ENV_PROXY`，也要确认没开）
2. 把 `com.vortex.helper` 一并纳入被监控 PID；或直接改判据为「全机范围内，除白名单进程外无新增外部连接」
3. 最强：仍然是原文档的检查点 1 —— **物理断网复跑**。本机同样需要用户手动操作网络适配器，我无权限。

### 4.3 新增风险：`tryClaimStep` 的 Redis 异常分支是 fail-open

`AgentStateManager.tryClaimStep`（`src/server/modules/AgentRuntime/AgentStateManager.ts:407-427`）：

```ts
} catch (error) {
  // Fail-open: on Redis error, allow execution to proceed
  console.error('Failed to acquire step lock:', error);
  return true;
}
```

即 **Redis 抖动 → 步锁直接放行**。这和附录 A.1 那条「本地模式下步锁是空实现」是同一族问题的两个面：一个是没有锁，一个是锁坏了就当没锁。配合附录 B 的循环失控（无 `maxSteps` 兜底），Redis 抖动期间的重复执行会直接乘上失控的 token 消耗。

建议在 PLAN.md 附录 A.1 补一条 🟡（有真 Redis 后可实测：`redis-cli DEBUG SLEEP` 或停服务，观察是否出现同一 `(operationId, stepIndex)` 被执行两次）。

### 4.4 Redis 5.0.14.1 的命令兼容性 —— 核对通过

本机是 Windows 原生 Redis 5.0.14.1（非官方 Linux 版），需确认版本够用。实际用到的命令：

| 命令 | 位置 | 最低版本 |
| --- | --- | --- |
| `XADD key MAXLEN ~ 1000 *` | `StreamEventManager.ts:95` | 5.0 |
| `XREAD BLOCK 1000 STREAMS` | `StreamEventManager.ts:206` | 5.0 |
| `SET key val EX n NX` | `AgentStateManager.ts:413` | 2.6.12 |
| `SETEX` / `GET` / `DEL` / `EXPIRE` | `AgentStateManager.ts:56,82,296,244` | ≤2.0 |
| `MULTI`(pipeline) / `LPUSH` / `LRANGE` / `HGETALL` | `AgentStateManager.ts:102,120,165,180` | ≤2.0 |

全部 ≤ 5.0，**5.0.14.1 够用**（Stream 恰好是 5.0 引入的）。已确认代码里没有用 `XAUTOCLAIM`(6.2) / `GETDEL`(6.2) / `SINTERCARD`(7.0) 等更新命令。

> 若后续要对齐生产，仍建议用 Docker 的 `redis:7-alpine`；但为了先解封 #2，本机原生 Redis 立即可用，无需等 Docker。

---

## 5. PLAN.md 中已过时、需要改写的具体位置

| 位置 | 原内容 | 应改为 |
| --- | --- | --- |
| 顶部「运行方针」块 | 「本机不能安装 Docker 与 WSL（决策 8）→ PGlite，Redis 不可用」 | 决策 8 作废；标注新主机能力 |
| §4.1 前置工具表 | Node/pnpm/bun 全部「❌ 未安装」，「这是阶段 4 当前的执行阻塞点」 | Node ✅ 24.11.1、bun ✅ 1.3.14、pnpm 待 corepack 激活；阻塞点已消除 |
| §4.3.1 第 1 行 | PostgreSQL「决策 8 改为 pgliteServer.ts」 | 可回到 Docker/WSL 真 PG；且**要 BM25 得用 paradedb 镜像** |
| §4.3.1 第 2 行 | Redis「❌ 不可用（决策 8）」 | ✅ 本机原生 5.0.14.1 已运行 |
| §4.7 `.env` 模板 | 注释掉 `REDIS_URL`、启用 `DISABLE_REDIS=1` | 反过来：启用 `REDIS_URL=redis://localhost:6379`，删掉 `DISABLE_REDIS` |
| §4.8 执行步骤 6 | 「起 PGlite；Redis 不可用」 | 起真 PG；Redis 已是常驻服务 |
| 检查点 11 | 「❌ 取消（决策 8）→ 待补测 #1–#5」 | 恢复为可执行 |
| 检查点 14 | 连接审计方法 | 补代理导致假阴性的说明（§4.2） |
| §6.4 缩范围声明 | 「明确删除：并发吞吐、错误率、吞吐拐点、连接池、步锁竞争；S6/S8 并发部分取消；1→50 梯度不做」 | 全部恢复；20 核/31.7 GB 支撑得住 |
| 决策 4 | 「~~Redis 双模对照~~ 被决策 8 推翻」 | 恢复 |
| 决策 5 | 「压测并发上限 50 —— 被决策 8 缩范围」 | 恢复完整梯度 |
| 决策 8 整节 + 「决策 8 的落地：基础设施降级」 | 整节 | 标注作废，保留为历史记录 |
| 待补测清单 | 8 项 | 按 §3 重判：6 项可解封、#5 已完成、#6 有条件 |
| 附录 A.1 | — | 新增 `tryClaimStep` fail-open（§4.3） |

---

## 6. 建议的执行顺序

分三档，从「零成本立刻见效」到「需要用户配合」。

### 档 1 · 不需要任何额外权限，先把阶段 4 重新落地（推荐立刻做）

```bash
# 1. 激活 pnpm
corepack enable && corepack prepare pnpm@10.33.4 --activate
```

然后：把 `plan/` 下的 `stubs/`、`tools/`、`bench/`、`scripts/local/`、`.env.offline.example` 复制进 `lobehub/`，把 8 条 `link:./stubs/*` 写回 `lobehub/package.json` 的 `pnpm.overrides`（**不是 `pnpm-workspace.yaml`**），再 `pnpm install`。

数据库这一步**先沿用 PGlite**（`scripts/local/pgliteServer.ts` 已跑通，零风险），但 **`.env` 立刻改成用真 Redis**：

```bash
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=lobechat
# DISABLE_REDIS 删掉
```

**这一步的收益**：附录 A.3 那条 🔴 SSE 静默失效直接消失，待补测 #2 解封，而且冒烟测试不再受 HMR 干扰（原文档记录过「27/0 掉到 22/5」的假失败）。

### 档 2 · 需要用户点一次 Docker Desktop

`com.docker.service` 是 Manual/Stopped，本会话非提权、`Start-Service` 被拒。但账户在 `Administrators` + `docker-users` 组，且 Docker Desktop 之前运行过 —— **用户手动启动 Docker Desktop（必要时点一次 UAC）即可**，之后 `docker` CLI 就能用。

起来之后：

```bash
bun run dev:docker
```

⚠️ 但如果要覆盖 BM25（待补测 #6），先把 `docker-compose/dev/docker-compose.yml` 里 postgresql 的镜像从 `pgvector/pgvector:pg17` 换成 `paradedb/paradedb:latest-pg17`。

**收益**：真 PG → 待补测 #6、#7 解封，阶段 6 的并发梯度恢复。

> WSL 是等价备选（Ubuntu 24.04 已装、有网），但 `sudo` 需要密码，本会话无法非交互执行 —— 同样需要用户配合，且 Docker 路径更接近仓库自带的 compose，优先级更高。

### 档 3 · 升级 qstash 存根，打开 queue 模式

按 §2 改造存根为本地 QStash 模拟器，`.env` 加：

```bash
AGENT_RUNTIME_MODE=queue
ZXQSTASH_TOKEN=local-mock-token
ZXQSTASH_CURRENT_SIGNING_KEY=<openssl rand -base64 32>
ZXQSTASH_NEXT_SIGNING_KEY=<同上，另一个>
AGENT_RUNTIME_BASE_URL=http://localhost:3010
```

**收益**：待补测 #1（步锁 / 429 / `Retry-After: 37`）、#3（TTL）、#4（pipeline）全部解封；`verifyQStashSignature` 的 fail-closed 路径首次获得真实覆盖；步间调度形态与生产一致，阶段 6 的「步间调度延迟占比」才有生产参考价值。

**顺带**：queue 模式跑起来后，附录 B 的循环失控会变成**跨请求的**失控（每步一次真实 HTTP），比原来同进程 `setTimeout` 更接近生产爆炸半径 —— 复现前务必先给 `createOperation` 打上 `maxSteps` 兜底，或准备好 `docker stop` / 杀进程的手段。

---

## 7. 与环境无关、结论不变的部分

以下结论**不因换主机而改变**，无需重测：

- 附录 B：Agent 循环失控（无默认 `maxSteps`/`costLimit`、`interruptTask` 无效、status 恒为 `idle`）—— 代码级缺陷
- 附录 C：HIL 双向失效（不传 `toolManifestMap` 静默绕过；传了之后 `pendingToolsCalling` 永不清除）—— 代码级缺陷
- A.4 全部安全项：`debug` 包劫持导致 LLM 正文外送、飞书 `appSecret` 硬编码在前端、开发态鉴权旁路三处入口、鉴权失败返回 500 而非 401、API Key 缓存 5 分钟、CORS 无 origin 限制
- 阶段 1–3 的接口 / 架构 / 功能点拆解
- 待补测 #5（O(N²) 写放大）—— 已完成，且与存储介质无关
- 8 个 `@ctrip/*` 私有包仍需存根（artifactory 本机同样不可达）

---

## 附：本次重估的实测命令与原始结果

```
node -v                      → v24.11.1
bun -v                       → 1.3.14
pnpm                         → 未安装（corepack 可用）
docker                       → CLI 在，daemon 未起（com.docker.service Manual/Stopped）
wsl -l -v                    → Ubuntu (Stopped, v2), docker-desktop (Stopped, v2)
wsl -d Ubuntu -- lsb_release → Ubuntu 24.04.4 LTS；curl registry.npmjs.org → 200；sudo 需密码
redis-cli ping               → PONG
redis-cli info server        → redis_version:5.0.14.1, os:Windows, tcp_port:6379
Get-Service Redis            → Running / Automatic
Get-NetTCPConnection 6379    → 127.0.0.1:6379 LISTEN (PID 5924)
Get-NetTCPConnection 5432    → 无
IsAdmin                      → False（账户在 Administrators + docker-users 组）
Start-Service com.docker.service → 拒绝（需提权）
CPU / RAM                    → 20 逻辑核 / 31.7 GB
磁盘                         → C 8.7GB free / D 88.4GB free / E 42.8GB free
ProxyEnable / ProxyServer    → 1 / 127.0.0.1:7897（com.vortex.helper PID 24820）
registry.npmjs.org           → 200
registry.npmmirror.com       → 200
artifactory.release.ctripcorp.com → 连接失败（预期）
```
