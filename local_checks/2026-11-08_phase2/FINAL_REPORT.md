# 第二阶段交付与验收（2026-11-08）

本轮沿用现有平台架构，完成Judge、单机Python归因和保守证据审核三个增量。已确认的核心链路阻塞已修复；并不意味着全库无缺陷或真实模型质量已验证。

## 最终验收

| 范围 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 最终选定TypeScript回归 | **945/945**，按文件和测试全名去重，无重复累计 | REGRESSION_SUMMARY.json；各组JSON及命令回执 |
| Python规则适配及审核 | **36/36** | increment3/python/formal-results.json、formal-regression.log |
| Judge真实HTTP | 真实PostgreSQL、原Agent runtime、原ModelRuntime→本地结构化Mock；9类评分结果、旧配置兼容、K=2全部通过 | increment1/http/results.json |
| Python归因真实HTTP | 三道质量失败unknown；真实计算器失败有可回查证据；四项独立任务、重复请求、原评分不变、跨用户隔离通过 | increment2/http/results.json |
| 真实登录和页面 | BetterAuth登录及四个Judge表单保存/API读回通过 | increment1/ui/attempt2/result.json及PNG |
| 原HTTP冒烟 | **27/27** | http/original-smoke-final.log、.json |
| 全库类型检查 | **失败，295个历史诊断位置**；本轮初始新增5处已消除，最终新增位置0 | logs/final-typecheck.log、TYPECHECK_LOCATION_COMPARISON.json |
| 补丁与原始参考 | 在冻结第一阶段副本检查、应用并逐文件比对成功；96份原始参考未变 | PATCH_VERIFICATION.json、SOURCE_CHANGES.json |

945项来自376核心运行/评分/解析、149数据库、58路由、157 Judge服务与配置、4组件渲染、71归因、128计算器、2实验Mock测试。Python、HTTP、UI和12例实验另列，不能与其重复相加为覆盖率。

## 源码审计结论及方案

原平台已有ModelRuntime、规则Judge、评测回写、外部评测扩展和async_tasks，原Python已有规则函数、模块分类树及LLM分类提示。本轮复用这些入口，新增明确合同和独立诊断任务，没有重做Agent平台、规则评分器或整套分类器。

Judge原先缺任务/评分上下文、表单配置不一致、执行错误与正常零分不易区分；本地多次采样的完成聚合与终态写入还存在竞态。采用原模型基础设施加局部硬截止、结构验证和终态条件写，保留原规则兼容。

Python使用现有扩展路由和async_tasks，固定本地子进程批处理。比常驻Python HTTP服务更少部署与跨语言网络状态；比同步挂在评分回调更能隔离异常和超时。代价是需要显式运行worker，不提供自动常驻调度。

持久化Trace能提供Run/Case/Topic/Thread、message parent、toolCallId及部分operation/trace身份，但没有完整provider请求和operation/span事件。本轮按实际覆盖度输出，不能把调用失败直接断定为内部参数模块错误。

## 修复记录与调用链

| 确认问题/根因 | 最小修复与关键文件 | 修改前→后证据 |
| --- | --- | --- |
| Judge任务/标准上下文遗漏、配置字段保存门槛错误 | eval-rubric；JudgeConfigFields及四个原表单；agentEval evalConfig schema | audit/judge/context-probe.json → increment1/REPORT.md |
| 初始化/模型不响应取消、空或非法输出、越界分数混成评分 | agentEvalRun/judge.ts硬截止及严格结构验证；index.ts标记评分来源与错误码 | increment1/pure-judge.json及最终157项 |
| 超时/终止后迟到评分覆盖、operationId覆写、重复聚合改终态 | runTopic条件写、run.finalizeIfActive、原orchestrator局部调用 | increment1/LIFECYCLE_AND_UI_FIX.md |
| 本地K=2完成hook未finalize，启动失败未聚合 | 原执行完成入口复用已有finalize/recordThreadCompletion | HTTP首次running失败 → increment1/K2_FIX.md及最终HTTP通过 |
| 本轮表单改动误删Input导入 | DatasetEditModal恢复导入并补组件回归 | UI attempt1错误页 → attempt2四表单通过 |
| 计算器返回error却被runtime丢弃 | builtin-tool-calculator runtime转发error一行 | tool-error-evidence/before.json → after.json，128/128 |
| MessageModel.create接收pluginError却未写入插件表 | message.ts解构及error入库两处 | message-create/NOTES.md：16通过1失败→17通过；真实HTTP最终有error |
| 实际工具来源存type，轨迹只读source；跨语言数值/Unicode摘要不同 | trace.ts兼容真实字段、冲突拒绝；contracts/Python统一摘要与引文表示 | increment2/trace-tests及bridge-tests前后记录 |

跨语言新能力的超时、退出、输出上限、非法合同、重复claim/旧lease、来源冲突和审核弃权均有专门回归。完整修改列表和SHA见SOURCE_CHANGES.json；根因及调用链详见各增量报告。

## 按增量交付

1. Judge：increment1/REPORT.md、DECISIONS.md、K2_FIX.md、LIFECYCLE_AND_UI_FIX.md。输入明确包含任务、预期/实际结果、标准及可用上下文；可配置provider/model/systemRole/timeout，并支持离线Mock。正常零分与评分器error分开。
2. Python：increment2/REPORT.md、DECISIONS.md。`agentEvalExternal.diagnosisRequest → extractTrajectory → async_tasks → evalAttribution CLI → 固定adapter.py → 独立诊断结果`；诊断不会调用评分回写覆盖原Case。
3. 证据：increment3/DECISIONS.md、python/REPORT.md、experiment/REPORT.md。先通过前两增量gate，再激活审核；证据存在和支持结论分别记录，不能证明内部责任时unknown/needs_review，保留原身份及引文。

## 实验真实结果与局限

12例是**受控合成边界**，direct使用真实SDK/HTTP到只回显预设候选的Mock，不是大模型推理实验。规则的有支持观察覆盖9/9，受控直接候选3/9，审核后1/9。审核拦截了不安全候选，但没有显示优于规则基线；合理改写和父节点缺失有错拒，原始失败样例全部保留。不得据此宣传归因准确率提升。

尚未解决/验证：

- 没有已确认可用的真实provider/model配置，未做真实模型质量、供应商取消/计费验证；这项不冒充通过。
- 无可靠真实脱敏标注集；合成结果不能代替真实Benchmark。
- Trace覆盖不完整，内部模块根因通常无法确认；其它工具错误持久化未全量审计。
- 审核白名单和完整性策略过于保守，当前适合审查与弃权，不能承诺自由文本因果结论审核完整。
- 全库295个历史类型诊断仍在。44处显示文本变化已分类披露，未观察新独立主因；截断泛型不能严格证明全部隐藏成员等价。它们不是295个已确认业务bug。
- 本机pg_search/BM25缺失，2项相关迁移明确跳过；私有依赖stub、生产部署、大规模并发、完整线上可用性未验收。
- worker为显式单机批处理；快照清理和长期运行调度留待后续，没有新增分布式组件。

本轮范围至此收口。操作与复跑见DEMO.md，技术决策可用于后续按工程搭建顺序教学。交付包是补丁、改动源码和审计证据，不含完整平台依赖、数据库或真实密钥。
