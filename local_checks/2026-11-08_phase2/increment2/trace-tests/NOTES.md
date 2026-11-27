# 只读轨迹提取：真实数据库集成回归

源码测试：`platform/src/server/services/agentEvalAttribution/__tests__/trace.integration.test.ts`。本子任务只新增测试，没有编辑trace.ts、contracts.ts或其它服务实现。

## 真实结果

| 记录 | 测试结果 | 子进程退出 | 耗时 |
| --- | --- | --- | --- |
| initial.json | 首版11/11通过 | 0 | 20.96秒 |
| coverage-red.json | 测试新增变量重名导致transform失败，0项；不计业务红 | 1 | 4.24秒 |
| coverage-before.json | 加入更严格unknown-source覆盖后11通过、1失败 | 1 | 18.80秒 |
| final.json | 主agent修复后12/12通过 | 0 | 26.10秒 |
| persisted-type-before.json | 真实持久化shape扩充后13通过、2失败 | 1 | 21.27秒 |
| persisted-type-after.json | 主agent修复持久化来源解析及冲突后15/15通过（最新） | 0 | 18.03秒 |

真实命令与退出码保存在results/*-command.json，原始输出在logs/。首次执行器工作目录参数错误也未计为业务结果；随后使用正确目录执行。

## 测试覆盖

- 读取前后比对run、runTopic、dataset、case、topic、thread、message、message_plugins共八张表；重复提取身份与inputDigest一致，未改变评分或状态。
- 正确保留message parent、traceId、operationId、assistant.tools来源指针；依据精确toolCallId将plugin结果绑定原call，错误来源指针指向原message_plugins行。
- 不同case复用同一callId时不会串线；builtin/mcp/plugin来源以持久化call字段为准，不凭工具名称猜测。
- run用户、真实存在但不属于run的case、另一case的thread、外用户thread全部拒绝；关联到该topic的外用户消息及关联到本用户message的外用户plugin记录不泄漏。
- K>1必须选择eval thread；选择后不包含main-topic或另一个thread的消息，即使它们复用相同callId；非eval thread拒绝。
- 孤立结果、unknown source给出coverage警告。没有tool结果的unknown source call同样必须警告。
- system指令中的error/timeout/PermissionError/500只是原始文本，不转成error事件；passed轨迹拒绝作为失败轨迹诊断。
- 500行边界可正常提取；501行、少于500行但展开超过500节点、序列化超过1MiB时拒绝整次提取，数据库原行数与内容保留，不静默裁剪。

## 真实发现与修复归属

coverage-before复现：unknown_source只在配对tool结果时加入warning；如果assistant.tools已有未知来源call而没有结果，节点是unknown但缺少unknown_tool_source覆盖原因。已向主agent反馈，主agent在call创建时补warning，最终回归通过。

另观察到展开节点超过500时原实现由Zod抛通用错误。主agent主动统一为trace_too_large，再将最终测试加强为明确错误码；保留了原先真实结果，不通过放宽限制取得通过。

随后真实HTTP审计确认assistant.tools的权威来源字段是`type:'builtin'`，先前构造fixture使用的source字段不足以覆盖真实持久化shape。新增三项：只有type而无source仍正确绑定builtin错误证据；已知lobe-calculator名字但无type/source不得猜builtin；source/type均声明但冲突应unknown并记录conflicting_tool_source。修复前真实15项中2项失败，上述纯名称控制组通过。源码由主agent修复，测试没有改变原12项断言。

持久化来源修复后的最新完整回归是persisted-type-after.json的15项；final.json保留此前12项历史结果，不覆盖原证据。

完整tsc另发现测试曾引用未从schema barrel导出的NewMessage；已改为`typeof messages.$inferInsert`推导真实合法插入类型，没有修改业务源或断言。

## 复跑

在platform目录运行：

```powershell
node node_modules/vitest/vitest.mjs run src/server/services/agentEvalAttribution/__tests__/trace.integration.test.ts --environment=node --maxWorkers=1 --hookTimeout=60000 --testTimeout=20000
```

也可从agent-eval-project根使用本目录run_command.py提供相同合成环境并保存输出，cwd参数为`../../../../local_checks/2026-11-08_platform_audit/platform`。测试用现有PGlite数据库实现与真实Drizzle模型/提取函数，不安装新依赖，不调用模型或Python分析器。它不代替真实PostgreSQL/HTTP归因执行与真实模型质量验收。

trace提取是新增符号，旧GitNexus图未含该符号；测试不修改业务符号，调用关系由静态import与直接extractTrajectory调用核对。
