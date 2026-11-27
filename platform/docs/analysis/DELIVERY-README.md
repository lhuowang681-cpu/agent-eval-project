# Calcifer ChatHub · Agent 项目分析与验证交付物

> 对象：`@ctrip/calcifer-chathub`（LobeChat 系 fork，内部名 LobeYoYo / TripYoYo）
> 基线：`main` @ `94dd700`　|　周期：2026-08-06 ~ 08-07
> 源分支：`docs/agent-analysis-plan`（18 个提交，未 push）

---

## 先读这三份

| 顺序 | 文件 | 内容 |
| --- | --- | --- |
| 1 | [reports/REPORT.analysis.md](reports/REPORT.analysis.md) | **综合结论** —— 亮点、16 个风险、优化点、上线建议。**开头是可信边界声明，务必先看** |
| 2 | [PLAN.md](PLAN.md) | 全程计划与执行记录，含附录 A（风险表）、**附录 B（循环失控）**、**附录 C（HIL 失效）** |
| 3 | [reports/REPORT.perf.md](reports/REPORT.perf.md) | 性能与成本，含范围声明（并发相关一律无效） |

---

## 目录结构

```
.
├── README.md                    ← 本文件
├── PLAN.md                      ← 计划 + 执行记录 + 三个附录
├── .env.offline.example         ← 离线环境变量模板（含"必须不设"清单）
│
├── docs/                        ← 阶段 1–5 分析文档
│   ├── README.md                  索引与规模速览
│   ├── 01-interfaces.md           接口拆解：79 个 REST 端点、517 个 tRPC procedure、核心链路时序
│   ├── 02-architecture.md         架构拆解：分层、依赖图、双运行时、调度模型
│   ├── 03-features.md             功能点：17 组 158 个可测点
│   ├── 04-offline-setup.md        离线启动手册（实测步骤 + 踩坑）
│   └── 05-functional-report.md    功能测试报告：L1 结果 + 缺陷汇总表
│
├── reports/
│   ├── REPORT.perf.md             阶段 6 性能与成本
│   └── REPORT.analysis.md         阶段 7 综合分析
│
├── tools/
│   ├── api-test/                  L3 契约测试（8 个脚本）
│   │   ├── client.ts                tRPC / REST / SSE 统一客户端
│   │   ├── helpers.ts               agent / topic / 消息脚手架
│   │   ├── smoke.ts                 冒烟：27 项断言，覆盖检查点 5–10
│   │   ├── agent-lifecycle.ts       F2 生命周期
│   │   ├── hil.ts                   F6 人在环
│   │   ├── sse.ts                   F3 流式输出
│   │   ├── tools-matrix.ts          F4/F5 工具调用
│   │   ├── openapi-contract.ts      F11 对外 REST
│   │   └── runaway-repro.ts         🔴🔴 循环失控复现脚本
│   ├── mock-llm/                  OpenAI 兼容 Mock LLM（13 个场景）
│   └── mock-services/             search / crawl / market / index 四合一
│
├── bench/                       ← 阶段 6
│   ├── run-scenarios.ts           串行基准驱动
│   ├── analyze/parseTracing.ts    快照聚合分析
│   └── runs.csv                   原始采样数据
│
├── scripts/local/               ← 离线环境搭建
│   ├── pgliteServer.ts            PGlite over socket（替代 Docker Postgres）
│   ├── seedDevUser.ts             种子用户 + RBAC 引导
│   └── setupOfflineMocks.mjs      伪造桌面端外部二进制
│
└── stubs/                       ← 8 个 @ctrip/* 私有包存根
    └── README.md                  为什么必须存根 vampire-core
```

---

## 核心结论速览

**已发现 16 个缺陷**，其中 1 个 🔴🔴、5 个 🔴。**拦截级四条**：

| # | 缺陷 | 实测证据 |
| --- | --- | --- |
| 1 | **Agent 循环无上限且中断无效** | 1 分钟 173 万 tokens、186 次 LLM 调用，5.9 步/秒线性增长；`interruptTask` 返回成功但停不下来，最后靠杀进程 |
| 2 | **HIL 双向失效** | 不传 `toolManifestMap`（schema 默认值 `{}`）审批被静默绕过；传了正常拦截后又永久卡在 `waiting_for_human` |
| 3 | **RBAC 无种子数据** | 三张表迁移后全空，`/api/v1` 每个权限端点一律拒绝，公开 API 开箱不可用 |
| 4 | **飞书 appSecret 硬编码在前端** | 随 SPA bundle 分发给每个访问者，应视为已泄露 |

**性能**（Mock LLM 零延迟，测的是框架自身开销）：纯文本 P50 **398ms**、单工具 **728ms**、三工具并行 **772ms**（并行属实）。LLM 延迟**线性传导**，系数约 1.0、偏差 ±20ms 内。**输入/输出 token 比 14:1**，2 步内上下文放大 **3.78×**。

---

## ⚠️ 三条使用须知

**1. 覆盖度不是 100%**

功能点覆盖约 **70 / 158**。空白主要在 F5 多数内置工具包、F8 子任务、F9 群体编排、F13–F15。

**2. ~~有 10 项完全未验证~~ → ✅ 10 项已全部关闭（2026-08-08/09）**

8 项需真 PostgreSQL + Redis（步锁、Redis Stream、TTL、**O(N²) 写放大**、BM25、并发吞吐、Redis 故障降级、pipeline 批写）—— **全部完成**；
2 项受测试手段限制（移动端 UI 对话、桌面端 `local-system`）—— **均已打通**：桌面端 14/0，移动端用 Playwright 真实键盘事件 10/0。

> 原文说「**O(N²) 写放大**最该先补」—— 已于 2026-08-07 完成：26 步放大 **6.9×**，二次拟合误差 5.8%，100 步外推累计写入 3.1 MB。
> **仍不可验证的边界**（不会因继续测试消失）：8 个私有包的真实行为、真实网关/设备对接、飞书出站链路、生产规模行为。

**3. 源分支不能直接合并**

分支上有几处**会破坏正常联网开发**的改动：

| 文件 | 改动 |
| --- | --- |
| `package.json` → `pnpm.overrides` | 8 条 `link:./stubs/*` |
| `packages/business/const/src/llm.ts` | `DEFAULT_PROVIDER` `tripflow` → `openai` |
| `package.json` devDependencies | 新增 pglite 三件套 |

要合并的话，**建议只挑纯新增的部分**（`docs/`、`REPORT.*.md`、`tools/api-test/`、`bench/`），把离线改造留在分支上。恢复方法见 `stubs/README.md` 与代码注释。

---

## 测试环境说明

全部结论产出于**完全离线**环境：

- PGlite 0.5.4（Postgres 18.3 WASM，含 pgvector）替代 Docker Postgres
- 无 Redis（本机不能装 Docker/WSL）
- Mock LLM + Mock Services 替代所有外部服务
- 8 个 `@ctrip/*` 私有包全部存根

零出网已实测：80 秒采样期间跑完整套冒烟，22 个进程的非回环出站连接 **0 条**。

复现方式见 [docs/04-offline-setup.md](docs/04-offline-setup.md)。
