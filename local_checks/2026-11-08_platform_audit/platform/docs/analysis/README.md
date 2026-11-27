# Agent 项目分析产出（阶段 1–3）

> 对应 [PLAN.md](../../PLAN.md) 的阶段 1–3。**全部为只读静态分析**：未安装依赖、未启动服务、未执行任何测试或构建。
> 仓库：`@ctrip/calcifer-chathub`（LobeChat 系 fork，内部名 LobeYoYo / TripYoYo）
> 基线：分支 `main` @ `94dd700`　|　完成日期：2026-08-06

> ⚠️ **本目录是静态分析阶段的产出，后续有大量实测推翻或细化了这里的结论。**
> **查当前状态请看 [PLAN.md](../../../plan/plan.md)**（3000+ 行，§14b–§25 是实测与修复记录），
> 或两份报告：[REPORT.analysis.md](../../REPORT.analysis.md)（含**实测评级后的亮点表**）、
> [REPORT.perf.md](../../REPORT.perf.md)。
>
> 本目录各文档已就「后来被证伪或已修复」的条目加了状态标记，但**详细过程只在 PLAN.md 里**。

## 文档索引

| 文档 | 内容 | 对应阶段 | 时效性 |
| --- | --- | --- | --- |
| [01-interfaces.md](01-interfaces.md) | 接口拆解：全部对外/对内接口清单、入参出参、依赖、核心链路时序 | 阶段 1 | 结构仍准确；**鉴权相关已更新**（SSE 加认证、API Key 缓存 60s） |
| [02-architecture.md](02-architecture.md) | 架构拆解：模块划分、依赖关系图、分层职责、关键抽象、编排调度机制 | 阶段 2 | 仍准确 |
| [03-features.md](03-features.md) | 功能点拆解：17 组 158 个可测试功能点清单 | 阶段 3 | 清单仍有效；**F2.4 步锁、F11.2 缓存已更新** |
| [04-offline-setup.md](04-offline-setup.md) | 离线启动手册 | 阶段 4 | ⚠️ **「无 Redis / PGlite」前提已作废** —— 现为真 Redis + ParadeDB |
| [05-functional-report.md](05-functional-report.md) | 功能测试报告 | 阶段 5 | ⚠️ **2026-08-07 快照，最过期** —— L2/L4 当时标「待做」，现均已完成 |

## 规模速览

| 维度 | 数量 |
| --- | --- |
| Next.js 后端路由文件（`route.ts`） | 64 |
| 对外 REST 端点（`/api/v1/*`） | 79 |
| tRPC `lambda` procedure | 517（50 个子 router）+ healthcheck |
| tRPC `tools` / `async` / `mobile` procedure | 25 / 9 / 15 |
| workspace 包 | 63（`packages/`）+ 2 apps |
| 模型 provider | 76 |
| 内置工具包 | 21（约 100 个工具 API） |
| 内置 Agent | 6 |
| 上下文 Provider / Processor | 24 / 16 |
| 数据库 schema | 31 张表 |
| 可测试功能点 | 158 |

## 阅读顺序建议

1. 先看 [02-architecture.md](02-architecture.md) 的「双运行时」与「单步 = 一次 HTTP 请求」两节 —— 这是理解整个项目的两把钥匙。
2. 再看 [01-interfaces.md](01-interfaces.md) 的「核心链路」章节，把接口挂到架构上。
3. [03-features.md](03-features.md) 作为阶段 5 测试用例的输入清单使用。

## 本轮分析的边界

- **未验证运行时行为**：所有结论来自源码阅读，标注为「推断」的条目需在阶段 5/6 实测确认。
- **未覆盖**：桌面端 Electron 主进程（`apps/desktop/`）、CLI（`apps/cli/`）、移动端；前端 UI 组件层（`src/features/`、`src/routes/`）只在与 agent 运行时耦合处提及。
- **代码引用格式**：`路径:行号` 均基于基线 commit `94dd700`。
