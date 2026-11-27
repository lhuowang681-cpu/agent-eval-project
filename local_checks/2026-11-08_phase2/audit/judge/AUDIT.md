# Judge 第二阶段只读审计

审计范围：当前platform源码（含第一阶段修复），未修改业务代码或第一阶段记录。执行GitNexus query/context及纯本地matcher上下文探针；没有调用真实模型、读取凭据值或连接业务凭据库。

## 结论

现有Judge已能接入ModelRuntime，第一阶段实现的双路径错误分类、显式模型选择与60秒取消信号保留。第二阶段最小增量应先修**配置真正保存、完整问题上下文、可区分的诊断，以及真实HTTP结构化Mock验收**。目前不足以宣称Judge已由登录页面到真实结构化模型接口全部打通。

### 1. 配置合同不一致，影响实际可用性（确定）

API `src/server/routers/lambda/agentEval.ts:39` 仅声明judgePrompt并passthrough；model/provider/criteria/systemRole未经类型或条件校验。create/update Dataset与TestCase都使用该Schema。Benchmark rubrics还是z.any数组。

运行时真正读取`RubricConfigLLM`的model/provider/criteria/systemRole，**没有任何matcher读取judgePrompt**。DatasetCreateModal:71、DatasetEditModal:86、TestCaseCreateModal:47、TestCaseEditModal:60都将“judgePrompt非空”作为整个evalConfig保存的条件；否则undefined/null。DatasetEdit即使显示model/provider/criteria，用户不填judgePrompt也会清空整份配置。创建数据集与创建/编辑TestCase仅显示judgePrompt，没有完整模型配置字段。

TestCase config通过`testCase.evalConfig ?? dataset.evalConfig`整份覆盖；题目只填写judgePrompt时不会继承数据集model/provider，随后被明确标error。当前未定义逐字段继承合同，不能未经设计便自动改变所有评测模式的覆盖语义。

### 2. 请求上下文（已纯本地执行确认）

| 现有类型 | input问题 | expected参考 | actual输出 | criteria |
| --- | --- | --- | --- | --- |
| llm-rubric | **缺失** | 有（非空时） | 有 | 有，未设时使用通用默认 |
| answer-relevance | 有 | 有（非空时） | 有 | 不读取；该模式本身是参考答案等价判定 |

证据：context-probe.json，`node --import tsx ../../2026-11-08_phase2/audit/judge/probe-context.mts`（platform为工作目录）。只调用现有matcher并注入返回固定score/reason的本地callback，不发HTTP。llm-rubric只有输出及参考时，无法完整判断“是否回答用户问题”；预期可为空的开放任务尤其明显。answer-relevance不读criteria是现有二值模式合同，不能仅据UI有该字段就认定它必须改成通用rubric。

路径：`matchers/index.ts:67–72`将input传给matchLLMEq，却不传给matchLLMRubric；后者`llmRubric.ts:26`构造prompt没有问题参数。服务evaluateOutput会原样传递matcher生成的messages和schema，不能在该层补回已丢失的问题。

### 3. 超时和非法返回

| 情形 | 当前处理与验证层级 | 缺口 |
| --- | --- | --- |
| 无model/provider | service预检查抛错；topic/thread写error | 第一阶段服务回归已覆盖 |
| HTTP/provider异常 | adapter保留异常，matcher虽转failed但service最终重新抛出并写error | 第一阶段只替换ModelRuntime对象，不是HTTP级验证 |
| 60秒超时 | `AbortSignal.timeout(60_000)`传入generateObject；OpenAI兼容工厂转交SDK signal | 未实际等待/触发HTTP取消；Provider忽略signal时不是硬上限；初始化runtime发生在计时信号创建前 |
| 空文本、非法JSON | 兼容工厂在generateObject中抛StructuredOutputParseError | 第一阶段未用真实HTTP响应覆盖这两种情形；解析失败日志会打印原模型文本，审计本身未触发 |
| null/非对象/缺score/NaN/越界/非string reason | service adapter拒绝，按error写回；库llm-rubric单独调用仍保留clamp合同 | 第一阶段服务只直接覆盖NaN；尚缺上述各形状的服务/HTTP用例 |
| 空字符串reason | 当前允许 | 是否视为无效需要明确，建议Judge结果要求非空诊断 |
| answer-relevance score=0.5 | service范围校验接受，matcher将非1归为0 | schema要求enum[0,1]但工厂只JSON.parse，不本地执行schema校验；需按模式校验，不能静默当答错 |

“库返回failed”与“平台服务按error写回”必须分清；不能用库级测试代替平台生命周期验收。

### 4. reason来源及生命周期

- 正常评分：`evalResult.rubricScores[].reason`来自模型原文；没有reasonSource、模型/provider、提示词版本或Judge请求ID。
- 评分基础设施错误：`evalResult.error`来自异常字符串，与Agent执行错误共用字段；UI只能通过自然语言猜原因，没有稳定judge_timeout/judge_parse等分类。
- Topic：recordTrajectoryCompletion → evaluateCase → evaluateOutput；异常落error，保留执行telemetry，随后回调/外层编排完成run。
- Thread：recordThreadCompletion → evaluateThread → evaluateOutput；先落thread.metadata再aggregateThreadResults。无通过且有error则topic error；至少一个通过按原pass@k通过，错误仍在threads明细。全局errorCases仅统计topic，因此“一个线程通过、另一个Judge失败”不会增加topic错误数。
- 第一阶段24项覆盖两类型×两路径×通过/0分/无配置/provider失败/NaN/非法weight；实际创建单个eval thread，没有覆盖K=2混合Judge故障的端到端语义。
- Agent有run snapshot；Judge配置/数据集/benchmark规则读取的是当前值，未发现等价Judge快照。运行中改配置及跨版本对比可重复性仍未验收，本增量不应冒称解决。

### 5. 原Mock支持边界

`tools/mock-llm/server.ts`支持Chat Completions非流式/流式、embeddings、模型列表与命名scenario；非流式正常返回scenario.turn.content，**不识别response_format/json_schema，原scenarios没有Judge JSON返回**，也没有Responses API路由。HTTP异常/timeout有通用注入场景，但不能仅靠原simple场景证明结构化Judge成功。

现有ModelRuntime OpenAI兼容工厂支持schema → Chat Completions response_format、Responses text.format、或部分供应商tool-calling fallback。最小受控演示可选明确走Chat Completions的本机模型名，只扩一个Judge专用Mock分支/场景，避免引入真实供应商或重写Mock全部协议。要同时校验收到的messages里含完整问题上下文，不能只返回永远满分的JSON后称Judge质量通过。

### 6. 真实模型可用性（严格受限结论）

env-presence.json仅检查当前审计进程的9个变量名称是否存在，均缺失，包括OPENAI_API_KEY/OPENAI_PROXY_URL/OPENAI_BASE_URL/AIHUBMIX_API_KEY等。未读取变量值、.env内容、数据库key vault；未付费调用。**不能据此推断整台机器或平台账户一定没有凭据**，也不能证明模型可调用或有额度。真实模型验收当前未具备可确认条件。

## 建议“最小增量1”设计（尚未实施）

1. 定义Judge配置小合同：model/provider必填且显式选择；criteria可按模式使用，systemRole可选。旧judgePrompt仅作为criteria的兼容别名（明确criteria优先），停止将它当保存开关。四个模态一致保留并校验实际字段，API使用同一字段类型/模式条件校验。题目与数据集配置继承先定合同，仅Judge范围决定，避免改变规则模式。
2. 在matcher入口将input传入llm-rubric prompt；保留老直接调用接口兼容性；补两模式完整prompt断言。不要把完整trace塞进Judge，不新增RAG/归因桥。
3. 使用JSON结果可加的可选诊断字段区分reasonSource='llm'与稳定错误类型；至少配置缺失/超时/解析/非法分数/provider错误可区分。按llm-rubric连续分、answer-relevance二值分分别验证；缺/空reason处理明确。保持原failed与error、pass@k规则。
4. 添加一个本机结构化Judge Mock受控通道（Chat Completions），支持正确/0分/空/非法JSON/越界/二值非法值/超时场景；通过真实PostgreSQL＋HTTP验证双路径、K=2、回写及报告。超时测试用受控较短时限或可注入signal，生产默认仍60秒。真实付费模型、自动重试、预算系统、Judge快照大改另列阶段。

建议验收：配置可从UI保存并回读；真实HTTP请求中含input/expected/actual/criteria（按模式）；评分成功与0分分别passed/failed；异常终结为error且报告有类型，不污染错误率分子；K=2行为与合同一致。全部使用Mock时明确标注“工程链路验收，不代表Judge质量”。

## 待impact符号与索引限制

- 库：`match`（matchers/index.ts，需按路径消歧）、`matchLLMRubric`、`buildJudgeUserPrompt`（llmRubric.ts）、`matchLLMEq`（仅若二值校验需要在库实现）。
- 服务：新`evaluateOutput`（旧图没有，静态直接调用者evaluateCase/evaluateThread）；必要时`evaluateCase`、`evaluateThread`、`aggregateThreadResults`（仅K错误语义明确调整才改）。
- 配置UI：DatasetCreateModal的handleCreate、DatasetEditModal提交回调、TestCaseCreateModal/TestCaseEditModal提交回调（按文件与实际符号定位）；路由evalConfigSchema及createDataset/updateDataset/batchCreateTestCases/updateTestCase等受影响resolver；新增共享校验/字段组件仅本地caller。
- Mock：handleChatCompletions、nextTurn（只有方案选择需要改时），新增Judge分支尽量不动其它scenario。

GitNexus query返回空（FTS extension unavailable）；context-evaluateThread、context-matchLLMRubric成功。图为原始ZIP恢复，含lower-bound声明，未包含第一阶段新增helper与新调用，不能认为图结果完整。query/context输出保存在本目录。此轮未编辑符号、未提交；实施前需要逐项impact并对HIGH风险提前告知。
