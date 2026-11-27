# Agent 评测系统第一轮修复与复测

日期：2026-11-08。现有规则评测的创建、Agent 执行、评分回写、报告、修改配置及重新评测，已在本机真实 PostgreSQL 和真实登录后的浏览器中跑通。保留原平台架构，没有新增 Python 归因桥接、Benchmark 或队列框架。

工作副本是 `../2026-11-08_platform_audit/platform`。原 ZIP 与 96 个只读参考快照未修改。平台实际改动为 15 个文件，其中 8 个业务源码文件、7 个测试文件；压缩源码只改注释。完整差异见 `platform.patch`，逐文件 SHA 及原件核对见 `source-integrity.json`。补丁已在独立原始夹具上实际检查、应用并核对 15 个文件内容，见 `patch-verification.json`。

## 已修复问题及前后证据

| 问题 | 根因与最小处理 | 修改文件与真实前后结果 |
| --- | --- | --- |
| 空候选数组、非法权重与阈值 | 无配置校验，空数组reduce异常，负权重可越界；改为明确配置错误，由服务写error | `packages/eval-rubric/src/evaluate.ts`；与后两行合计新增23项修复前19失败4通过，修复后全通过 |
| 非法regex、科学计数数字 | RegExp异常无配置诊断；删除字母把1e3变13并会拼接多个数值；增加诊断、提取完整数字token | `matchers/regex.ts`、`numeric.ts`；科学计数、千分位、多数字回归，原业务断言保留 |
| JSONL报错行号 | 过滤空行后用新下标报错；保留物理行号 | `packages/eval-dataset-parser/src/parsers/jsonl.ts`；行号/preview回归通过 |
| Judge合法零分 | truthiness把0当缺失；改为null/undefined检查，保留原clamp契约 | `matchers/llmRubric.ts`；原13项通过但新0分回归失败，修复后14/14 |
| 65%实现与50%断言 | 原工程设计报告明确已从50%改为65%，注释/四个旧断言未同步；保留实际策略并覆盖83200/83201及显式50% | `packages/agent-runtime/src/utils/tokenCounter.ts`及测试；258项254通过4失败→259/259。设计证据在`compression_judge/DESIGN_EVIDENCE.md` |
| 归因CLI崩溃与误判恢复 | 空DataFrame缺列、坏行中断、任意后续工具成功当恢复；固定空输出schema、隔离坏行并记录真实文件行号、保守确认同轮同工具同参数成功重试 | 修复入口`attribution/structured_jsonl_attribution.py`，不覆盖只读快照；同组10项原1通过6失败3异常→10/10，原四组合成CLI重放4/4 |
| Judge上下文缺失和错误分类 | 两评分路径没传generateObject；topic异常只打印、thread异常未处理，聚合会误算答错 | `src/server/services/agentEvalRun/index.ts`；复用既有ModelRuntime，仅显式model/provider才调用，评分故障写error。有效基线12项全失败→12/12，扩展已有answer-relevance后24/24 |
| 三题已评分但整轮仍running | local完成hook丢弃allDone，没有调用既有finalizeRun；增加已有最终聚合调用 | 同一服务文件`executeTrajectory`；顺序/并行/重复回调两项回归均先失败后通过，真实PG两轮三题再验证 |
| 登录页面默认Agent创建运行500 | UI提交inbox别名，直接落库违反真实PG Agent外键；创建和更新复用当前用户Inbox真实ID解析 | 同一服务文件及`src/server/routers/lambda/agentEval.ts`；4项原3失败1通过→4/4，覆盖用户隔离、首次Inbox、快照/topics与ID一致、普通ID/null/省略字段语义 |

每项详细文件、命令、退出码、耗时及修复前后日志分别在 `scoring/NOTES.md`、`attribution/README.md`、`compression_judge/REPORT.md`、`completion/NOTES.md`、`inbox_alias/NOTES.md`。新增测试在各说明和补丁中列明。没有直接删除失败断言；压缩旧预期的调整有原工程文档依据和新的边界测试。

## 最终回归结果

| 独立测试组 | 结果 | 最终结果文件 |
| --- | --- | --- |
| Agent Runtime | 259/259 | `compression_judge/runtime-after.json` |
| 评分及数据集解析 | 113/113 | `scoring/after.json` |
| 评测数据库模型 | 132/132 | `regression/db-models-after.json` |
| 评测运行服务 | 95/95 | `inbox_alias/service-final.json` |
| 评测路由 | 58/58 | `inbox_alias/router-final.json` |
| 去重合计 | **657/657** | `RESULTS.json` |

Judge24项、本地完成2项、Inbox4项已分别包含在服务/路由组内，不能重复累加。归因10项与四组CLI重放单列。完整服务及路由已在最后一次Inbox修复后再次执行，真实退出码均为0。

这些是选定相关回归，不是全库覆盖率或项目完整度。自动数据库/服务集成组仍用原 PGlite 测试实现和明确标注的替身；以下 HTTP/浏览器证据使用真实 PostgreSQL。

全库 TypeScript 检查**未通过**。首次明确退出2，295条诊断，原本没有全库修改前基线，不能认定全部为既有问题。最终默认Node堆检查又因内存耗尽退出134；显式8GB堆复查正常结束并退出2，仍为295条诊断，本轮15个改动文件没有对应诊断，见`typecheck-summary.json`、`results/typecheck-final-8gb-command.json`及日志。不能以Vitest绿代替类型检查绿。

## 真实 PostgreSQL 与 HTTP

真实 PostgreSQL 16.15、pgvector 0.8.6，107迁移成功、110张表。两项 pg_search/BM25 搜索迁移因标准Windows PostgreSQL没有相应扩展未执行，未写假成功。数据库初始化使用ASCII临时路径解决中文路径编码失败，不改业务连接池。

- 原 HTTP/SSE/计算器工具冒烟27项通过；最终一键启动器已完整重启Next+Vite+Mock并在最终代码上再次27/27通过，退出0，日志`http/original-smoke.log`。
- `http/http-three-case-before-completion-fix.json`保存第一次真实PG失败：三个topic均passed、score=1，但run仍running、passRate/averageScore=0。修复后使用UI同款`targetAgentId=inbox`完整重跑，`http/http-three-case-eval.json`中v1/v2各3题均completed，评分1，通过率/平均分1，旧v1配置快照仍保存v1。
- 上轮PGliteSocket的prepared statement/portal协议错误在本次真实PG未重现。这支持其属于替代环境限制的判断；不等于生产并发性能已验证，也没有通过改单连接池掩盖问题。
- `http/judge-errors.json`：未配置Judge及Mock故意返回非JSON两组，各3题正确记录error、failedCases=0，整轮failed并终结。这是预期错误处理通过，不能描述为这些题目答对。配置齐全的请求已实际进入结构化生成，返回错误为JSON解析失败。

模型始终是项目原有本机Mock，无真实付费LLM调用。变更配置后固定Mock仍通过只能证明工程链路，不能证明提示词优化效果或Judge评测质量。

## 登录后的真实页面

最终`ui/attempt7/result.json`的8步（含API前置准备）全部通过：真实两步密码表单登录及会话检查→打开/eval→UI创建Benchmark/数据集/三题→选择默认TripYoYo AI→启动→报告Completed、3/3→修改数据集描述→新运行maxSteps从8改16并重测Completed、3/3。API只用于为合成用户准备本机Mock Agent；之后清除会话，重新走登录表单，业务请求没有注入开发认证头。

最终Benchmark为`evb_MphKY9r66R5m`，运行`run_XMPoD5rkcjW5`和`run_3kqWVEn5ZZyp`。真实请求两次均提交inbox别名并返回200。逐步截图、可见文本、实际mutation请求体和报告证据保存在同目录。Agent系统角色v1/v2修改与旧快照验证由HTTP组单独完成，不冒称已在UI操作Agent设置。

页面异常0、HTTP错误0；外部字体按测试配置阻断并记录，另有现有Antd弃用警告及开发组件浮层，不能称所有资源和控制台零错误。七次尝试中的环境阻塞、选择器修正和真实产品缺陷均保留于`ui/README.md`。尤其`attempt6/failure-evidence.json`是默认Inbox修复前真实PG外键失败证据。

## 影响分析及原件

编辑前按仓库规范新建本地GitNexus图并运行上游impact。共享评分/匹配器为HIGH，已先告知；涉及evaluateCase/evaluateThread/TaskReviewService.review。压缩公共链路亦HIGH，但本轮不改运行策略。创建/更新匿名入口图未解析，结果UNKNOWN，另静态核对tRPC→service→model/topics/快照，不把零边当作零影响。

图索引后处理曾因工具安装问题中断，查询主体可用；有FTS不可用、流程裁剪及下界警告，不能称完整影响证明。未提交代码。对ZIP恢复11256个原文件重新比较，变更仅本轮清单内15文件；96参考快照全部hash不变。

## 剩余问题和未验证能力

1. 全库类型检查未过；需单独建立原始基线和逐组处理，不能在本轮声明全库可发布。
2. 真实Judge供应商的schema支持、质量、可重复性、费用/配额、提示注入及实际超时取消尚未验证。本轮仅局部接通上下文与故障分类；创建数据集模态judgePrompt与编辑模态model/provider等配置仍不一致。
3. 标准PG缺少BM25；生产QWorkflow/QStash、云沙箱及8个原私有包仍用本地替身，未验证真实云队列重试/持久化、生产并发和部署。
4. 原updateRun替换Agent不刷新旧snapshot/预建topics的版本语义仍待定义。本轮演示采用修改Agent后创建新run，不能把修改旧run当作同一功能已完善。
5. 归因恢复只确认同轮同工具同参数重试成功，不证明整个用户任务完成。坏行输出input_complete=false；跨trace、换参数后恢复及真实标注集准确率未验证。
6. 本地批量运行的maxConcurrency与实际启动调度边界未做性能验收；本轮只验证三题功能闭环，不提供负载或SLA结论。

LLM Judge后续完善、Python归因桥接和Benchmark没有在本轮扩展开发。可在本轮结果审阅后，围绕这些明确剩余项再拆工作量。

## 复现与补丁

完整启动、真实登录、自动验收、查看报告和停止步骤见`DEMO.md`。归因必须运行本轮修复入口，不能运行只读快照后期待获得修复。

迁移到另一份同版本原平台时先备份，运行`git apply --check --ignore-space-change platform.patch`，再应用；本工作副本已修复，不要重复打补丁。补丁不包含私有凭据、数据库数据、整份依赖或数据库二进制。
