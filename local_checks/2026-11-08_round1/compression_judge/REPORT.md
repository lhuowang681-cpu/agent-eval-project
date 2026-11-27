# 第一轮：压缩策略与 Judge 修复记录

## 已确认根因与最小改动

| 问题 | 根因 | 修改 |
| --- | --- | --- |
| 压缩4项原测试失败 | 已有运行默认65%，注释和硬编码断言仍写50%/75% | `packages/agent-runtime/src/utils/tokenCounter.ts` 仅改注释；`tokenCounter.test.ts` 按原设计文档更新旧预期，补70k及显式50%覆盖，保留83200/83201边界 |
| Judge上下文缺失 | `evaluateCase` / `evaluateThread` 未传generateObject | `src/server/services/agentEvalRun/index.ts` 新增局部evaluateOutput，复用initModelRuntimeFromDB/generateObject，明确model/provider才调用，不选隐式默认模型 |
| 评测故障被当答错或未回写 | topic catch仅console.error，thread无catch；线程聚合将无通过一律写failed | 原有评分异常写error；保留telemetry及完成信号，线程聚合在无通过且有error时写error，指标计入errorCases |

Judge适配同时服务已有llm-rubric与answer-relevance两种匹配器。生成返回需要有限数值0–1与字符串reason；使用现有运行时AbortSignal超时60秒。合法0分属于failed；缺配置/供应商错误/非法结构属于error。ModelRuntime模块在Judge callback才动态导入；规则评测不加载这个新增依赖入口、不初始化LLM。不新增Provider、接口、数据库表、Python桥接或队列。

`matchLLMRubric`合法0分库级问题由scoring子任务单独修复，原有clamp库合同保留；服务适配严格校验模型结果，防止非法分数进入评测。

## 设计证据及影响检查

详见DESIGN_EVIDENCE.md。原始平台`docs/analysis/05-functional-report.md:73–78`明确要求65%及83200阈值；没有可用git历史，不能声称查到了最初产品策略实验。

编辑前已对从ZIP恢复的源码新建GitNexus索引并真实执行upstream impact；索引后处理曾中断，但图主体可查询，结果明确为下界，且执行流程存在裁剪，不能作为完整影响证明：getCompressionThreshold LOW、shouldCompress HIGH、evaluateThread LOW、evaluateCase LOW、recordTrajectoryCompletion MEDIUM、aggregateThreadResults LOW。JSON在本目录impact-*.json。主agent已告知高风险路径；本次不改变压缩执行函数，只纠正注释/测试。新helper直接调用者仅两处评分函数。未提交代码。

## 真实结果

- Runtime修复前：258项，254通过/4失败，runtime-before-red.json；修复后：259/259，runtime-after.json。
- Judge新增服务回归基线：12项，0通过/12失败，judge-baseline.json；首轮修复后：12/12，judge-after.json。
- 后续将同一回归扩展到已有answer-relevance模式，共24项；最终24/24通过，见judge-final.json，耗时约93.82秒。涵盖两种模式、topic/thread两路径、通过/合法0分/无配置/供应商异常/非法数值/非法规则权重，核对回调完成信号、落库状态及errorCases/failedCases。
- 最终完整评测服务回归95/95通过（69项原测试 + 24项本任务Judge回归 + scoring任务新增2项本地完成回调回归），11个文件，约150.25秒。见service-final.json及results/service-final-command.json。与Judge单跑24项存在重叠，不能相加成119项独立测试。
- 第一次全服务回归沿用默认浏览器环境，240秒超时，不能记作通过；随后单worker/node环境复测也240秒超时（日志明确66项完成，非全绿）。改为Judge动态导入并用两个worker执行最终全组回归，见service-final.json。以上失败/超时全部保留。TypeScript检查实际exit 2，约239.69秒，295条TS诊断（日志590行）；本任务四个改动文件未出现在诊断中。全库类型检查未通过，未运行修改前全库类型基线，不能据此宣称所有诊断均为既有。
- 初始沙箱运行realpath EPERM导致Vitest未采集任何测试，即使JSON内success:true也不是通过。保留runtime-before.json、judge-before.json及日志，不把它们算测试结果。
- 最早两次Judge基线夹具存在回调参数/错误要求回调直接完成run状态的问题，均已保留，不作为有效基线。有效基线judge-baseline使用testCaseId与allDone/allRunDone原有回调合同。

## 复现

在platform目录运行（Windows如遇sandbox EPERM需在正常本机终端运行）：

```powershell
python ../../2026-11-08_round1/compression_judge/run_command.py runtime-replay ../../2026-11-08_platform_audit/platform/packages/agent-runtime node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1
python ../../2026-11-08_round1/compression_judge/run_command.py judge-replay ../../2026-11-08_platform_audit/platform node node_modules/vitest/vitest.mjs run src/server/services/agentEvalRun/__tests__/agentEvalRunService.judge.test.ts --maxWorkers=1
```

已有数据集编辑界面提供evalConfig.model/provider/criteria/systemRole。设为真实账户有权限的模型和供应商可启用Judge；本轮没有访问真实付费模型。API可提供同样字段；缺少model/provider将明确error。

## 剩余限制

1. 服务回归使用PGlite及ModelRuntime对象替身；证明上下文调用、评分回写及错误分类，不证明真实模型质量或供应商schema支持。真实PostgreSQL、HTTP运行及UI另由主任务验证。
2. 60秒signal依赖具体Provider遵守取消信号；真实供应商超时、计费/配额、提示注入与Judge可重复质量尚未验证，下一阶段评估。
3. 创建数据集模态仅judgePrompt字段、编辑模态提供model/provider等字段，存在UI配置不一致；本轮不扩建Judge产品配置。
4. 多线程中至少一个通过仍按原pass@k合同通过，个别线程error保留在threads数组；未更改原pass@k/pass^k统计定义。
