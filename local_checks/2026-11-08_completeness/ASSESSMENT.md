# 项目完整度初步盘点与验证顺序

日期：2026-11-08。本次为原始ZIP目录及精选源码静态检查，没有启动完整平台、安装依赖或执行平台测试。此前CPU实测仅覆盖当前学习包的归因脚本，见同级上层2026-11-08_cpu_smoke/REPORT.md。

## 必须纠正的范围判断

当前agent-eval-project中的96个参考文件只是选取的学习快照，缺少平台启动清单，不表示原始项目缺少这些功能。原始somethingelse-main-main.zip仍可读取，其中codinganalysis/lobehub包含package.json、pnpm-lock.yaml、pnpm-workspace.yaml、Dockerfile和部署配置。此前依据当前学习包提出的数据集/评测编排等“需新增”判断，只适用于独立个人实现路线，不能作为原始平台的功能缺失结论。

原始平台已有数据集解析、评分rubric、评测业务数据模型、评测运行服务、工作流接口及前端路由。中间执行链也存在源码，不能视为完全空白。平台内置任务评测和独立Langfuse故障归因脚本是不同范围，二者自动连接仍待核实。

## 源码存在性证据

以下路径相对原包codinganalysis/lobehub，不相对当前学习目录：

| 能力 | 代码位置与定位 | 状态 |
| --- | --- | --- |
| 完整工程描述 | package.json、pnpm-lock.yaml、pnpm-workspace.yaml、Dockerfile | 源码/配置存在，未安装构建 |
| 依赖 | 根package指定pnpm@10.33.4，含Next/React、数据库和Redis依赖，并列8个@ctrip范围依赖 | 清单已读，私有包当前可访问性/替代方案未验证 |
| 测试数据集解析 | packages/eval-dataset-parser/src/parseDataset.ts及CSV/JSON/JSONL/XLSX适配 | 实现及测试文件存在，未执行 |
| 评分规则 | packages/eval-rubric/src/evaluate.ts及matchers | 实现及测试文件存在，未执行；规则评分与模型judge分别验证 |
| 评测持久化 | packages/database/src/models/agentEval/及schemas/agentEvals.ts | benchmark/dataset/run/runTopic/testCase模型存在，未迁移运行 |
| 评测服务 | src/server/services/agentEvalRun/index.ts:createRun约60行、abortRun约115行、retryErrorCases约141行、executeTrajectory约242行 | 方法实现存在，未端到端验证 |
| 编排与回调 | 同目录orchestrator.ts:runBenchmark约58行、executeTestCase约243行、runAgentTrajectory约272行、onTrajectoryComplete约475行 | 执行与完成回写的代码路径存在，未验证运行连通性 |
| 服务接口 | src/server/routers/lambda/agentEval.ts、agentEvalExternal.ts；src/app/(backend)/api/workflows/agent-eval-run/ | 路由与分步工作流文件存在，未验证请求/鉴权/部署 |
| 评测界面 | src/routes/(main)/eval/等 | 路由和组件存在，未打开或验证交互 |
| 相关测试 | eval-rubric、eval-dataset-parser、数据库模型、agentEvalRun服务及agentEval集成测试 | 文件存在不等于通过；尚未运行 |
| 独立归因工具 | 当前source-reference/attribution/ | CPU小样例与1000条合成输入跑通，已复现3项局限，见实测报告 |
| 内置评测到独立归因 | 尚需沿真实Trace导出/事件映射和分类输入逐字段核对 | 未核实；不能根据同有Trace名就声称已打通 |

archive_inventory.json记录目录、清单及定位摘要；不包含.env或真实凭据内容。上面静态行号按原始ZIP内版本，不假设与当前runtime-reviewed快照相同。

## 验证顺序与过关条件

1. **完整性和基线**：在隔离目录恢复所需源码（排除真实凭据与数据），明确当前选择的原版/修订版，核对工作区包、锁文件、私有依赖、数据库迁移、服务配置。每项记已验证/存在未验证/确实缺失/环境阻塞；先不填写百分比。
2. **安装与启动**：确认Node/pnpm兼容、安装/构建是否可重现，核对必要PG/Redis及认证路径；能打开本机页面、保存一条配置、读回持久数据。私包失败单列，不能误判为业务功能缺失。
3. **无模型费用的模块测试**：优先数据集解析、确定性rubric、配置校验和数据模型测试。记录真实命令、环境、通过/失败/跳过及失败原因；不把Mock等同真实服务。
4. **最小Agent运行**：用固定模型替身和只读工具完成一题；确认工具调用、结果回填、最终回答、结束状态和执行身份。再加入超时/取消/一次工具失败，观察证据完整性。
5. **平台内置评测闭环**：导入3道规则可判的题→选择Agent→创建run→执行→完成回写→查看结果→重试失败题。逐个核对testCase/runTopic/operation/trace身份和状态，不先做负载测试。
6. **独立归因接入**：取实际运行产生的轨迹，经明确适配后送入归因工具，结果回链到原题/原run。先检查空失败、坏行和无关工具恢复三个已复现问题；只有修复并回归后才宣称稳定接通。
7. **修改后重测**：固定数据集和比较条件，保存配置及评测规则版本，比较改善/退步题目和成本；明确是否完整快照，不能只读最新Agent配置当历史版本。
8. **正确性后再性能**：检查批量、并发、重投、超时和内存；真实模型调用另需可用接口及明确预算。无GPU不阻碍大多数服务端/规则测试，本地模型推理未测试。

## 初步结论

原平台的评测相关源码比当前学习包呈现的完整，平台端、内置评测端和编排连接层都有实现基础。是否达到70%不能从文件数量推算，先以“能否完成三题的端到端闭环”为验收单位；外接归因是否已连接仍需独立验证。当前不应按三部分全部从零开发，也不应据静态文件存在直接宣称即插即用。
