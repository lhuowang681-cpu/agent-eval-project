# 增量1：Judge上下文、配置与生命周期

## 根因 → 改动

| 根因 | 修改文件 |
| --- | --- |
| llm-rubric丢任务input；参考答案模式缺少criteria/choices/category | packages/eval-rubric/src/evaluate.ts、matchers/index.ts、llmRubric.ts、llmEq.ts、types.ts；保留旧直接调用/clamp行为 |
| judgePrompt不被执行，却是四表单配置保存开关 | 四个Dataset/TestCase Create/Edit模态；新增JudgeConfigFields.tsx、config/judgeConfig.ts；新增七个中英文资源键的中文文案（default及zh-CN），没有默认模型 |
| API只声明judgePrompt、配置类型不清 | src/server/routers/lambda/agentEval.ts仅evalConfigSchema；packages/types/src/eval/agentEval.ts、rubric.ts的可选字段 |
| signal依赖provider遵守；初始化未计时；非法结果与错误来源不清 | 新服务judge.ts，index.ts评分局部；hard deadline、abort、迟到rejection处理、严格分数/非空reason、typed errorCode及scoringSource |
| Judge晚完成可能覆盖timeout/abort/已评分行、重复线程结果 | RunTopicModel新增两个局部原子方法；index.ts指定评分/telemetry/聚合点条件写，固定锁序短事务，不改原通用update语义 |
| 原Mock没有结构化Judge响应、全局scenario切换易竞态 | tools/mock-llm/judge.ts与server.ts：逐model固定场景，context布尔统计，不改普通Agent模型场景 |

详细设计合同见DECISIONS.md；审计与修改前上下文实测见../audit/judge/context-probe.json。第一阶段记录未覆盖或修改。

## 真实回归结果

- 修改前只读context探针：llm-rubric缺input；answer-relevance缺criteria；修改后新增4项上下文回归通过。
- 评分包99/99通过，含原规则和clamp兼容回归，rubric.json。
- 硬期限/非法结构/Mock/表单helper合计23/23通过，pure-judge.json。含provider忽略signal仍按时返回、初始化晚完成不调用模型、late rejection不产生未处理拒绝、合法0分、binary 0.5拒绝、空reason、边界timeout校验。
- 服务首轮45项43通过/2失败：两个K用例错误假定数组下标对应线程；DB按创建时间倒序，改为根据threadId验证同一线程，保留judge-lifecycle.json，不修改业务迎合顺序断言。
- 随后完整服务136/136通过，service-all.json：第一阶段95项+本轮生命周期21+deadline17+Mock3。包括K=2混合评分故障、两路径late timeout/abort/passed/failed、并发重复callback、完整case覆盖合同。
- 最终补充每rubric来源标记后，冻结Judge源码，final-regression.json **139/139通过，15个文件，176.76秒**（136项服务+3项表单helper）。与pure-judge、service-all、judge-lifecycle有大量重叠，不累计为新增测试。与评分包99项是不同测试文件，共238项独立局部测试；不是全库测试通过率。
- 新增字段与组件的全库TypeScript结果由主任务统一对照，不把第一阶段295条既有诊断或Vitest通过误报为全库类型通过。

## 真实HTTP/UI验收之后的补修

本主报告上述数字记录初次冻结结果；后续验收发现K2本地hook缺finalize、迟到operationId覆盖结果、K2 startup reject未聚合、重复finalize修改终态metrics、以及本轮误删Input import导致Edit页面ReferenceError。全部保留失败证据，未修改旧断言规避。

补修后最终完整服务/配置 **157/157通过，17文件，175.06秒**（final-lifecycle-regression.json）；独立评分包99/99、Modal组件渲染4/4，共260项独立局部测试。不是全库覆盖率或真实供应商能力证明。旧139/147等结果与最终157重叠，不累计。

最终原有路由/工作流集成另54/54通过（router-regression.json，2文件，42.92秒），验证finalize改动与原API/编排兼容；与上述260来自不同测试文件，合计314项局部测试。

根因/文件/红绿结果分别见K2_FIX.md、LIFECYCLE_AND_UI_FIX.md。最终完整服务/配置组见final-lifecycle-regression.json；真实页面以ui/主任务记录为准，四个实际modal的组件渲染回归modal-render.json 4/4通过。最终类型检查由主任务执行，threadIds隐式any[]已修为string[]。

## 复现命令

platform为工作目录：

```powershell
python ../../2026-11-08_phase2/increment1/run_command.py rubric-replay ../../2026-11-08_platform_audit/platform/packages/eval-rubric node ../../node_modules/vitest/vitest.mjs run --maxWorkers=1
python ../../2026-11-08_phase2/increment1/run_command.py service-replay ../../2026-11-08_platform_audit/platform node node_modules/vitest/vitest.mjs run src/server/services/agentEvalRun/__tests__ 'src/routes/(main)/eval/config/judgeConfig.test.ts' --environment=node --maxWorkers=2 --testTimeout=20000 --hookTimeout=60000
```

Windows沙箱若出现realpath EPERM，应在普通本机终端运行；不能把0 tests的report success:true当通过。日志和命令记录在logs/、results/。

## 仍需主任务验收/后续问题

- 真PostgreSQL + 实际ModelRuntime + HTTP Mock完整三题、失败场景、配置重测与页面操作，不能用本服务替身测试代替。
- 真实模型质量、供应商取消/计费、额度及提示注入未知；本轮没有真实外部模型调用。
- Judge规则/数据集/benchmark运行快照仍未建立；运行中更改规则的可重复性不承诺。
- 并发重复请求可能在首个评分完成前重复发起Judge调用；原子写保证首个结果不被覆盖，不宣称实现跨进程“只付费一次”。
- 已补run finalize终态CAS及并发abort保护；不改变通用update方法语义，不宣称平台所有非finalize写入或跨进程事件都实现exactly-once。
- 增量2/3归因与benchmark不属于本目录验收，通过情况由主报告分别收口。
