# 项目逐任务搭建规格

这是现在补建的教学搭建规格，不是原作者历史。它与 E01—E18 教材互相配合：教材负责先讲明白，任务卡负责明确本步输入、增加的机制、验证和完成产物。

A—H 主要做机制走查与教学推演；不会让用户重写整个平台。I—J 的源码路径和接口均为拟建，不代表当前已存在。Codex 负责主要编码，用户核对合同与理解结果。

## 阶段 A：业务目标、数据合同与最小场景

先决定系统要解决什么、处理什么对象，给后续机制一个一致的输入输出。

<a id="a1"></a>

### A1 定义平台与归因工具的业务边界

**目标：** 能从用户需求解释被测平台与评测工具各做什么。

**为什么在这一步做：** 不先定义产品边界，就会把平台、分析器与报表功能混在一起。

**前置：** 无。关联教材：[E01](../book/index.html#E01)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 查询订单等业务需求，当前参考包及来源清单。 |
| 输出 | 一张请求→执行→轨迹→适配→归因→报告图，附当前范围声明。 |
| 参考现状 | 已有文档：范围与来源已有文档；原包不等于用户独立产品。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/A1_范围图.md` |

**按顺序走一遍：**

1. 教练先讲完整业务例子与两类用户：业务用户和平台开发者。
2. 沿例子标出谁执行业务、谁保存事实、谁分析和谁读报告。
3. 确认参考已有、个人待新增和本轮非目标，保存范围图。

**完成标准：**

- 能说明归因工具的输入、输出及使用者。
- 能说明为什么工具失败不等于平台源码故障。
- 范围图不把原平台写成本人开发。

**一定要解释的失败反例：** 把 Excel 报表生成当作已经开发完整 Agent 平台。

**可选来源核对：**

- [docs/book/lessons/00_项目总介绍.md](../book/lessons/00_项目总介绍.md)
- [docs/EXISTING_CODE_SPEC.md](../EXISTING_CODE_SPEC.md)
- [SOURCE_MANIFEST.json](../../SOURCE_MANIFEST.json)

<a id="a2"></a>

### A2 定义任务、Trace、节点与调用身份

**目标：** 为关联和计数建立不会互相替代的对象身份。

**为什么在这一步做：** ID 关系错误会同时污染证据回链、恢复判断与影响统计。

**前置：** A1。关联教材：[E01](../book/index.html#E01)、[E06](../book/index.html#E06)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 一个任务、多条 Trace、重复调用和同会话新任务的教学账本。 |
| 输出 | 身份字典及来源字段映射，注明哪些是回退键。 |
| 参考现状 | 参考部分具备：旧入口有身份和回退策略，尚未统一为独立业务 task_id 合同。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/A2_身份字典.md` |

**按顺序走一遍：**

1. 解释四类对象的含义及 tool_call_id 的关联责任。
2. 逐行标记同任务与不同任务，分别数事件、Trace、任务、Session。
3. 对缺失 sessionId、重复 node ID 和跨 Trace 任务写处理约定。

**完成标准：**

- 两次真实重试不误合为同一事件。
- 重复采集同一调用不重复算真实失败。
- Session 回退值不冒充真实 Session。

**一定要解释的失败反例：** 同一任务重试三次被统计成三名受影响用户。

**可选来源核对：**

- [source-reference/runtime-reviewed/packages/agent-runtime/src/types/state.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/types/state.ts)
- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md](../../source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md)

<a id="a3"></a>

### A3 定义成功、失败、恢复与未知

**目标：** 让状态判断依据事实合同，允许证据不足。

**为什么在这一步做：** 未发现 Error 不是成功，后续任意工具成功也不是原任务恢复。

**前置：** A2。关联教材：[E05](../book/index.html#E05)、[E06](../book/index.html#E06)、[E09](../book/index.html#E09)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 明确失败、明确成功、模糊返回和无关工具成功四类记录。 |
| 输出 | 调用成功/失败、步骤恢复、任务完成、未知的判定表。 |
| 参考现状 | 参考部分具备：失败信号检测存在；恢复代理与严格任务成功合同仍有差距。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/A3_结果合同.md` |

**按顺序走一遍：**

1. 先区分调用结果和业务目标验收。
2. 逐例解释能够确认的事实与缺失证据。
3. 定义只允许部分结论成立时的输出方式。

**完成标准：**

- 模糊返回不会被默认为明确成功。
- 天气成功不会解除订单失败。
- 记录直接失败和内部责任的不同证据需求。

**一定要解释的失败反例：** 只要最后一条返回不含 error 就记任务恢复。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/developer_source_attribution_spec.md](../../source-reference/attribution/developer_source_attribution_spec.md)

<a id="a4"></a>

### A4 建立贯穿全程的最小案例账本

**目标：** 后续每增加一种机制，都能用相同场景观察改前改后。

**为什么在这一步做：** 统一样例能显出每个模块增加了什么，避免各节只讲抽象名词。

**前置：** A1、A2、A3。关联教材：[E01](../book/index.html#E01)、[E16](../book/index.html#E16)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 合法日期请求、错误参数、外部 500、重复采集、缺证据。 |
| 输出 | 至少五张纸面案例卡，含节点、身份、预期和不能确认之处。 |
| 参考现状 | 已有教学示例：教材已有订单等合成案例，尚未形成可运行评测样例集。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/A4_案例账本.md` |

**按顺序走一遍：**

1. 先完整走一遍日期拒绝案例。
2. 只改变一个条件，生成外部失败或证据缺失反例。
3. 保存预测结果；标明尚未运行程序。

**完成标准：**

- 每张卡有清楚输入与预期。
- 至少一个反例会使责任结论改变。
- 预测和实测不混写。

**一定要解释的失败反例：** 从程序输出倒抄期望，无法揭穿实现缺陷。

**可选来源核对：**

- [docs/EXISTING_CODE_SPEC.md](../EXISTING_CODE_SPEC.md)

## 阶段 B：先让 Agent 完成一次决策与执行

建立最小运行循环，再逐步加入工具、结果回填和终止控制。

<a id="b1"></a>

### B1 用户输入到决策指令

**目标：** 理解状态和本步情境怎样产生下一动作。

**为什么在这一步做：** 提出要做什么与真正执行必须能区分，才容易测试和定位。

**前置：** A4。关联教材：[E02](../book/index.html#E02)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 当前 State、用户请求和 phase。 |
| 输出 | call_llm / 调用工具 / 等待 / finish 等指令职责图。 |
| 参考现状 | 参考源码可见：Brain、Runtime 和状态类型可静态核对，当前未部署运行。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/B1_决策图.md` |

**按顺序走一遍：**

1. 教练用纯文字回答的最小路径讲 State、Context 与 Instruction。
2. 把订单请求加入同一状态，说明模型为什么可能提出工具调用。
3. 标记决策输入、输出和副作用边界。

**完成标准：**

- 能说明 phase 与运行状态的区别。
- 能区分决策器与模型本身。
- 每个动作都有执行方，而非把指令当已完成事实。

**一定要解释的失败反例：** 模型提出查询即被当成查询已经成功。

**可选来源核对：**

- [source-reference/runtime-reviewed/packages/agent-runtime/src/agents/GeneralChatAgent.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/agents/GeneralChatAgent.ts)
- [source-reference/runtime-reviewed/packages/agent-runtime/src/core/runtime.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/core/runtime.ts)
- [source-reference/runtime-reviewed/packages/agent-runtime/src/types/state.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/types/state.ts)

<a id="b2"></a>

### B2 接入工具执行与审批分支

**目标：** 理解外部副作用怎样受工具合同和人工介入约束。

**为什么在这一步做：** 工具能执行不代表策略信息完整，审批与执行脱节会产生治理漏洞。

**前置：** B1。关联教材：[E02](../book/index.html#E02)、[E03](../book/index.html#E03)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 工具名、参数、调用 ID、manifest 与审批决定。 |
| 输出 | 立即执行、等待批准、拒绝或未知策略的分支表。 |
| 参考现状 | 参考源码可见：工具执行与 manifest / 人工介入路径可见，成功恢复待本轮验证。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/B2_工具审批表.md` |

**按顺序走一遍：**

1. 先讲合法只读查询，再加入需要审批的动作。
2. 解释 manifest 缺失与 manifest 未声明审批的差别。
3. 走批准、拒绝、重复批准三个场景，说明各自验收。

**完成标准：**

- 不会把工具未知直接当无需审批。
- 能说明批准后如何关联原待执行调用。
- 知道执行成功与审批机制正确需分别验证。

**一定要解释的失败反例：** 只测试弹出审批，没有测试拒绝和恢复执行。

**可选来源核对：**

- [source-reference/runtime-reviewed/packages/agent-runtime/src/agents/GeneralChatAgent.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/agents/GeneralChatAgent.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/RuntimeExecutors.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/RuntimeExecutors.ts)
- [source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts)

<a id="b3"></a>

### B3 工具结果回填并驱动下一轮

**目标：** 把一轮调用串成多轮任务，而不是孤立工具测试。

**为什么在这一步做：** 工具成功但结果丢失时，任务仍可能失败。

**前置：** B2。关联教材：[E02](../book/index.html#E02)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 调用结果、旧状态、消息身份与事件。 |
| 输出 | 调用→实际结果→回填→下一轮可见输入的时序图。 |
| 参考现状 | 参考源码可见：执行返回 newState、events、nextContext 的机制存在。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/B3_回填时序.md` |

**按顺序走一遍：**

1. 走一次成功返回订单的例子。
2. 在结果回填前设置教学故障，比较后续决策。
3. 标出状态快照、事件和消息各自承担什么。

**完成标准：**

- 能定位结果在哪一边界进入后续决策。
- 能区分工具错误与结果漏回填。
- 指出保存前崩溃的待验证恢复问题。

**一定要解释的失败反例：** 工具 HTTP 200 就作为端到端任务成功。

**可选来源核对：**

- [source-reference/runtime-reviewed/packages/agent-runtime/src/core/runtime.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/core/runtime.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/RuntimeExecutors.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/RuntimeExecutors.ts)
- [source-reference/runtime-reviewed/packages/agent-runtime/src/types/state.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/types/state.ts)

<a id="b4"></a>

### B4 加入预算收敛和取消控制

**目标：** 使任务不会仅依赖模型自愿停止。

**为什么在这一步做：** 循环预算、单次超时和取消是不同控制维度。

**前置：** B3。关联教材：[E03](../book/index.html#E03)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 持续工具调用、步数/成本预算、执行中取消。 |
| 输出 | 软收敛、硬停止与取消生命周期对照卡。 |
| 参考现状 | 参考源码可见：修订版含预算、硬闸、中断标记；只证明机制可见。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/B4_终止治理.md` |

**按顺序走一遍：**

1. 解释持续重复调用如何导致失控。
2. 对照软收敛与硬闸，说明正常长任务的代价。
3. 用旧状态覆盖取消信号的时间线解释独立中断标记。

**完成标准：**

- 能解释取消受理与外部动作真正中止的差别。
- 至少列三个固定条件实验而非只看 diff。
- 历史报告数字不作为本轮结果。

**一定要解释的失败反例：** 取消接口返回成功，但 Worker 覆盖状态后仍继续调度。

**可选来源核对：**

- [source-reference/runtime-original/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-original/src/server/services/agentRuntime/AgentRuntimeService.ts)
- [source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts)
- [source-reference/runtime-reviewed/packages/agent-runtime/src/core/runtime.ts](../../source-reference/runtime-reviewed/packages/agent-runtime/src/core/runtime.ts)

## 阶段 C：把运行循环放进服务端状态与异步架构

解释为什么有服务层、状态存储、事件和队列，而不要求复刻其全部基础设施。

<a id="c1"></a>

### C1 确定单步执行边界和下一步调度

**目标：** 理解一次 HTTP / Worker 执行怎样连接到后续步骤。

**为什么在这一步做：** 异步边界使执行可分段，但增加身份、重复和恢复问题。

**前置：** B4。关联教材：[E02](../book/index.html#E02)、[E03](../book/index.html#E03)。

| 对象 | 合同 |
| --- | --- |
| 输入 | operation 身份、当前步、执行结果与继续条件。 |
| 输出 | 服务端单步与客户端循环的对照顺序图。 |
| 参考现状 | 参考源码可见：服务端与不同队列实现可见，不等于全部部署形态已验证。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/C1_调度边界.md` |

**按顺序走一遍：**

1. 用两轮模型调用说明为何不是一个请求内无界循环。
2. 区分本地与远端调度实现，不把一种部署概括为全部。
3. 标出步骤结束、保存与安排下一步的关系。

**完成标准：**

- 能说明下一步由谁安排。
- 不把 Runtime 引擎与队列当同一个组件。
- 列出重复调度需要核验的身份与副作用。

**一定要解释的失败反例：** 同一步被重入两次，却没有检查是否重复执行。

**可选来源核对：**

- [source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts)
- [source-reference/runtime-reviewed/src/server/services/queue/impls/local.ts](../../source-reference/runtime-reviewed/src/server/services/queue/impls/local.ts)
- [source-reference/runtime-reviewed/src/server/services/queue/impls/qstash.ts](../../source-reference/runtime-reviewed/src/server/services/queue/impls/qstash.ts)

<a id="c2"></a>

### C2 区分业务持久数据与运行态

**目标：** 能解释 Redis、内存替身和业务数据库的不同责任。

**为什么在这一步做：** 缓存或临时状态不应被误认为长期业务存储，替身也不等于真实依赖。

**前置：** C1。关联教材：[E02](../book/index.html#E02)、[E15](../book/index.html#E15)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 运行状态、业务消息、操作元数据与过期策略。 |
| 输出 | 数据责任图：数据由谁保存、谁是权威、丢失影响什么。 |
| 参考现状 | 参考部分具备：运行态实现及服务内数据库模型调用可见，本包不是完整数据库工程。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/C2_存储责任图.md` |

**按顺序走一遍：**

1. 先比较当前快照与用户消息的保存需求。
2. 解释真实状态管理器和内存实现的验证范围。
3. 在重启或过期情景下推演哪些数据需要重新获取。

**完成标准：**

- 能说出至少两类数据的读写路径。
- 知道内存演示不证明跨进程恢复。
- 不会把 Redis 当所有业务数据的唯一长期来源。

**一定要解释的失败反例：** 状态过期后仍宣称完整历史随时可重放。

**可选来源核对：**

- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/InMemoryAgentStateManager.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/InMemoryAgentStateManager.ts)
- [source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts)

<a id="c3"></a>

### C3 处理步锁、并发与中断控制信号

**目标：** 理解多个执行方同时作用于同一 operation 时的风险。

**为什么在这一步做：** 单进程顺序演示看不出丢失更新、锁过期和重复副作用。

**前置：** C2。关联教材：[E03](../book/index.html#E03)、[E15](../book/index.html#E15)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 同一步重复到达、执行中取消、锁过期和晚到结果。 |
| 输出 | 并发时间线与需要验证的约束清单。 |
| 参考现状 | 参考源码可见：步锁和独立中断实现存在，真实 Redis 并发未由本轮运行。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/C3_并发故障卡.md` |

**按顺序走一遍：**

1. 画两个执行方同时进入同一步的时间线。
2. 说明锁键和控制标记要解决的问题，不宣称天然 exactly-once。
3. 推演旧执行方迟到写回，列出需在真实环境验证的点。

**完成标准：**

- 能说明锁存在不等于副作用绝不重复。
- 取消信号不依赖易被旧快照覆盖的普通状态解释。
- Mock、静态可见与并发实测分别登记。

**一定要解释的失败反例：** 锁过期后旧 Worker 仍返回并覆盖新状态。

**可选来源核对：**

- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentRuntimeCoordinator.ts)
- [source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts)

<a id="c4"></a>

### C4 记录事件并衔接可观测轨迹

**目标：** 说明运行事实怎样成为可供离线分析的记录。

**为什么在这一步做：** 当前状态只能告诉现在，事件和轨迹帮助解释过程；不能假设所有事实都被采集。

**前置：** C2、C3。关联教材：[E02](../book/index.html#E02)、[E13](../book/index.html#E13)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 决策、调用、结果、状态变化及结束事件。 |
| 输出 | 事件字段与 Trace 所需字段的映射，标出采集缺口。 |
| 参考现状 | 参考部分具备：运行事件与输出机制可见；完整统一 Langfuse 埋点集成未在此包验证。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/C4_事件到轨迹.md` |

**按顺序走一遍：**

1. 列出订单流程中必须观察的事实。
2. 区分用户流式事件、持久业务消息与分析记录。
3. 标出节点 ID、调用 ID、时间和父链缺失后会丢哪些判断。

**完成标准：**

- 有从业务执行到分析输入的具体映射。
- 未验证的观测集成明确标为缺口。
- 结束事件不是用户任务质量成功的充分证明。

**一定要解释的失败反例：** UI 显示结束，但工具结果和父链没有可回查记录。

**可选来源核对：**

- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/StreamEventManager.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/StreamEventManager.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/AgentStateManager.ts)
- [source-reference/runtime-reviewed/src/server/modules/AgentRuntime/RuntimeExecutors.ts](../../source-reference/runtime-reviewed/src/server/modules/AgentRuntime/RuntimeExecutors.ts)
- [docs/EXISTING_CODE_SPEC.md](../EXISTING_CODE_SPEC.md)

## 阶段 D：轨迹接入与统一数据适配

先把不同来源整理成可审计的输入，再让后续算法判断。

<a id="d1"></a>

### D1 区分拉取、缓存、JSONL 与工作簿入口

**目标：** 明确每个入口的依赖、输入和输出，不拼成假想统一流水线。

**为什么在这一步做：** 本地读取不保证分类和输出无网络调用。

**前置：** A4、C4。关联教材：[E04](../book/index.html#E04)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 四类来源说明与主入口开关。 |
| 输出 | 入口合同及外部依赖表。 |
| 参考现状 | 参考源码可见：多个入口存在，offline 只控制特定步骤。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/D1_入口合同.md` |

**按顺序走一遍：**

1. 教练分层讲数据来源、分析方式和输出去向。
2. 按开关逐步预测哪些步骤会被跳过。
3. 选择合成 JSONL 作为个人首轮输入，不直接执行旧入口。

**完成标准：**

- 能解释 offline 与 skip_classify 的区别。
- 导入副作用有明确标注。
- 首轮离线合同不包含真实模型或企业拉取。

**一定要解释的失败反例：** 误以为加 offline 就不会请求模型接口。

**可选来源核对：**

- [source-reference/attribution/badcase_analysis.py](../../source-reference/attribution/badcase_analysis.py)
- [source-reference/attribution/langfuse_fetcher.py](../../source-reference/attribution/langfuse_fetcher.py)
- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/DELIVERY_README.md](../../source-reference/attribution/DELIVERY_README.md)

<a id="d2"></a>

### D2 还原消息、工具调用与父子关系

**目标：** 让同一次调用的发出、返回和上游关系可回查。

**为什么在这一步做：** 配错对象后，后面的正确算法也只能得出错误归因。

**前置：** D1、A2。关联教材：[E05](../book/index.html#E05)、[E07](../book/index.html#E07)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 嵌套消息、乱序返回、父 ID 与原始记录位置。 |
| 输出 | 节点映射与调用配对结果，附孤立返回和断链列表。 |
| 参考现状 | 参考部分具备：不同导出有不同适配，尚无一个统一验证的规范模型。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/D2_关联结果.md` |

**按顺序走一遍：**

1. 用两工具并发例子说明为何不能按相邻位置配对。
2. 走一次解码与提取，把原始位置留在派生记录中。
3. 加入缺失调用和断父链，说明可保留与不可确认的事实。

**完成标准：**

- 乱序返回仍能关联正确调用。
- 孤立返回不补造上游输入。
- 节点缺失在输出中可见。

**一定要解释的失败反例：** 天气结果错误配给订单请求，随后被认作订单恢复。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/reconstruct_langfuse_export.py](../../source-reference/attribution/reconstruct_langfuse_export.py)
- [source-reference/attribution/trace_denoiser.py](../../source-reference/attribution/trace_denoiser.py)

<a id="d3"></a>

### D3 定义来源类型与身份回退策略

**目标：** 分清数据来源标签、责任判断与业务身份。

**为什么在这一步做：** 工具接入方式不能独自决定事故责任，回退字段不能冒充原始事实。

**前置：** D2。关联教材：[E05](../book/index.html#E05)、[E06](../book/index.html#E06)、[E09](../book/index.html#E09)。

| 对象 | 合同 |
| --- | --- |
| 输入 | builtin / MCP / plugin / unknown 名称及缺失 ID。 |
| 输出 | 来源依据、置信边界与回退标记表。 |
| 参考现状 | 参考部分具备：名称启发式与 sid 回退存在，不代表真实来源和任务身份已证明。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/D3_来源与回退.md` |

**按顺序走一遍：**

1. 按旧规则纸面预测各来源分流。
2. 构造名称误判与 Session 多任务反例。
3. 将来源事实、规则推断和责任结论分栏保存。

**完成标准：**

- unknown 不被表述为已确认外部无内部责任。
- 回退 ID 的统计限制能说明。
- 能区分来源硬分流与广义双结论分析。

**一定要解释的失败反例：** 来源为 MCP 就认为 Agent 不可能存在错误重试。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md](../../source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md)

<a id="d4"></a>

### D4 接收质量、坏行和原始证据保留

**目标：** 使丢弃、缺失、裁剪和字段转换都可解释。

**为什么在这一步做：** 静默删数据会让覆盖率和计数产生假完整性。

**前置：** D2、D3。关联教材：[E04](../book/index.html#E04)、[E13](../book/index.html#E13)、[E16](../book/index.html#E16)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 非法 JSON 行、缺字段、重复节点及长内容。 |
| 输出 | 接收统计：总数、可用数、坏行位置、缺失项与分析范围。 |
| 参考现状 | 参考部分具备：原脚本有不同失败处理与截断策略，严格接收审计需新合同。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/D4_输入质量合同.md` |

**按顺序走一遍：**

1. 先定义坏行是否整批停止或隔离继续。
2. 比较原始输入、规范视图和摘要三个层次。
3. 为每个派生字段记录来源与变换依据。

**完成标准：**

- 输入总数与各去向可核对。
- 缺失值不被默默当空结果或零。
- 审计能从结果回到原始行。

**一定要解释的失败反例：** 丢掉不可解析行，却声称分析覆盖原始全部记录。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/trace_denoiser.py](../../source-reference/attribution/trace_denoiser.py)
- [source-reference/attribution/references_reporting_spec.md](../../source-reference/attribution/references_reporting_spec.md)

## 阶段 E：从原始返回形成可靠失败与责任候选

区分事件事实、影响计数、恢复与责任，避免一条规则承担全部判断。

<a id="e1"></a>

### E1 明确工具与 Provider 的失败信号

**目标：** 只在明确返回证据上形成失败事件。

**为什么在这一步做：** 关键词可以出现在正常文本，规则未检出也不等于成功。

**前置：** D4、A3。关联教材：[E05](../book/index.html#E05)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 真实工具返回、退出码、Provider output 与正常说明。 |
| 输出 | 失败事实、信号字段和未能判定的记录。 |
| 参考现状 | 参考源码可见：failure_envelope 与 Provider 合同规则存在，覆盖有限。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/E1_失败判定表.md` |

**按顺序走一遍：**

1. 比较 status=failed 与说明文字中的 error。
2. 逐项解释布尔字段、状态、前缀和退出码信号。
3. 保留未知结果并注明规则覆盖范围。

**完成标准：**

- 成功含 error 说明不会仅按单词误报。
- 每个失败都有实际返回字段或明确形式。
- 未知状态可保留，不强制判成功。

**一定要解释的失败反例：** 用户提到异常的提问被统计成工具故障。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)

<a id="e2"></a>

### E2 采集去重与受影响任务计数

**目标：** 同时保留真实异常次数和业务影响范围。

**为什么在这一步做：** 频率和优先级依赖计数单位，不能用一个名称含糊替代。

**前置：** E1、A2、D3。关联教材：[E06](../book/index.html#E06)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 重复导出、真实重试、同任务跨 Trace 与同 Session 新任务。 |
| 输出 | 事件/Trace/任务/Session 四层账本和去重说明。 |
| 参考现状 | 参考部分具备：各入口去重和计数单位不同，aggregate 不是天然按任务计数。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/E2_去重账本.md` |

**按顺序走一遍：**

1. 先去掉同一调用的重复采集。
2. 保留独立重试事件，再按可靠任务身份去重影响。
3. 检查旧 n_sessions 与 topic 回退字段的实际含义。

**完成标准：**

- 重复采集不增加事件。
- 真实重试增加事件但不重复增加同任务影响。
- 每个汇总数字注明单位与回退限制。

**一定要解释的失败反例：** 用分类行数直接称受影响任务数。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/aggregator.py](../../source-reference/attribution/aggregator.py)
- [source-reference/attribution/cause_convergence.py](../../source-reference/attribution/cause_convergence.py)
- [source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md](../../source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md)

<a id="e3"></a>

### E3 判断原失败步骤是否真正恢复

**目标：** 区分调用恢复、步骤恢复和最终任务完成。

**为什么在这一步做：** 最终任务是否达标必须回到原目标，而非消息顺序。

**前置：** E2、B3。关联教材：[E06](../book/index.html#E06)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 修正参数后成功、无关工具成功及模糊返回。 |
| 输出 | 恢复状态与支持节点，缺证据则未知。 |
| 参考现状 | 参考部分具备：旧 recovered 是任意后续未判失败工具的代理，需严格对照。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/E3_恢复对照.md` |

**按顺序走一遍：**

1. 先演示原调用纠正并完成目标。
2. 只替换后续工具为天气成功，对照结论变化。
3. 说明旧规则会如何误标和新合同应要求什么。

**完成标准：**

- 恢复关联原失败目标。
- 未检出失败不直接作为成功证据。
- 保留仍未知的最终业务质量。

**一定要解释的失败反例：** 订单失败后另一个工具返回正常即清除任务失败。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)

<a id="e4"></a>

### E4 拆开直接原因与内部责任候选

**目标：** 按输入来源、最早异常和反事实提出可核对责任。

**为什么在这一步做：** 外部故障与内部错误处理可以并存，修复效果必须针对具体后果。

**前置：** E1、E3、D2。关联教材：[E09](../book/index.html#E09)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 合法调用遇 500、超预算重试、来源不明参数拒绝。 |
| 输出 | 直接原因、内部候选、证据节点、修复作用与不确定性。 |
| 参考现状 | 参考部分具备：双结论规范存在，结构化来源硬分流未覆盖全部内部治理情形。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/E4_双结论卡.md` |

**按顺序走一遍：**

1. 沿用户目标、合同、参数与返回解释传播链。
2. 找到违反内部合同的最早可见节点。
3. 写保持外部条件不变时能避免什么，不能改善什么。

**完成标准：**

- 不把首次外部 500 直接当内部异常。
- 修重试只承诺减少额外调用，不承诺修外部服务。
- 证据不足不会硬归模块。

**一定要解释的失败反例：** 只有 ToolExecutionError 就认定工具执行模块有源码缺陷。

**可选来源核对：**

- [source-reference/attribution/developer_source_attribution_spec.md](../../source-reference/attribution/developer_source_attribution_spec.md)
- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)

## 阶段 F：保留证据并形成规则或模型分类

理解输入压缩、分类词表、模型输出与硬校验的各自职责。

<a id="f1"></a>

### F1 生成精简轨迹并暴露裁剪

**目标：** 在预算内保留会改变判断的证据。

**为什么在这一步做：** 只保留最后报错会丢掉来源；压缩体积不是唯一目标。

**前置：** E4。关联教材：[E07](../book/index.html#E07)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 原始节点、错误链与节点/字符预算。 |
| 输出 | 精简视图、原始证据位置、保留理由和裁剪说明。 |
| 参考现状 | 参考部分具备：去重、祖先和邻域保留已实现，max_nodes 仍可能截断祖先。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/F1_裁剪反例.md` |

**按顺序走一遍：**

1. 先说明节点父链与时间邻域互补。
2. 用小预算手工推演保留结果。
3. 比较裁剪前后哪些责任结论仍成立。

**完成标准：**

- 关键节点丢失时限制结论范围。
- 不宣称完整祖先链永远保留。
- 保留原始输入与派生视图区别。

**一定要解释的失败反例：** 删掉用户指定错误参数的节点后，误判为 Agent 自主生成。

**可选来源核对：**

- [source-reference/attribution/trace_denoiser.py](../../source-reference/attribution/trace_denoiser.py)

<a id="f2"></a>

### F2 固定分类树与候选输出合同

**目标：** 让不同分析路径输出可比较候选，而非随意起标签。

**为什么在这一步做：** 统一表达帮助聚合，但不替代事实支持。

**前置：** E4、F1。关联教材：[E08](../book/index.html#E08)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 规范事件、模块词表与证据。 |
| 输出 | 分类字段字典：类别、模块、原因、置信、复核与候选。 |
| 参考现状 | 参考源码可见：8层56模块词表及多入口分类字段可见，字段命名尚需适配。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/F2_分类合同.md` |

**按顺序走一遍：**

1. 解释模块职责与错误机制的层级差别。
2. 对照同一案例在规则和模型中的可能输出。
3. 记录 first_abnormal 与 first_internal 等字段适配。

**完成标准：**

- 合法模块不被当作归因正确证明。
- 原始错误类型与分析标签分开。
- 缺字段有明确兼容或拒绝规则。

**一定要解释的失败反例：** 把所有无法解释的问题都扔进一个编排兜底桶。

**可选来源核对：**

- [source-reference/attribution/taxonomy.py](../../source-reference/attribution/taxonomy.py)
- [source-reference/attribution/llm_classifier.py](../../source-reference/attribution/llm_classifier.py)
- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)

<a id="f3"></a>

### F3 模型请求、解析、失败与复核

**目标：** 知道模型是候选分析器，不把调用成功当判断正确。

**为什么在这一步做：** 接口异常、解析失败与被测业务失败是不同事故。

**前置：** F2、D1。关联教材：[E08](../book/index.html#E08)、[E15](../book/index.html#E15)。

| 对象 | 合同 |
| --- | --- |
| 输入 | payload、分类规则和模拟模型返回。 |
| 输出 | 请求到归一化结果的顺序图及失败分流表。 |
| 参考现状 | 参考部分具备：请求、JSON 提取、部分重试和 fallback 可见，真实模型效果未验。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/F3_模型失败分流.md` |

**按顺序走一遍：**

1. 先讲发送哪些业务字段及长度预算。
2. 比较 JSON 不合法、模块非法、低置信与客户端失败。
3. 说明重试增加成本，confidence 不是准确率。

**完成标准：**

- 不运行真实接口也能解释各层职责。
- 分类器失败不冒充业务根因。
- 客户端创建与调用异常位置不一概承诺同一回退。

**一定要解释的失败反例：** 模型不可用被报成原业务 Observability 故障。

**可选来源核对：**

- [source-reference/attribution/llm_classifier.py](../../source-reference/attribution/llm_classifier.py)
- [source-reference/attribution/badcase_analysis.py](../../source-reference/attribution/badcase_analysis.py)

<a id="f4"></a>

### F4 审查证据引用与语义支持缺口

**目标：** 明确未来个人校验增量究竟补什么。

**为什么在这一步做：** 提示词要求真实证据，不等于程序已强制验证。

**前置：** F2、F3。关联教材：[E08](../book/index.html#E08)、[E09](../book/index.html#E09)、[E17](../book/index.html#E17)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 合法 JSON 但 n99 不存在、ID 存在却不支持结论等输出。 |
| 输出 | 结构/枚举/ID存在/一致性/语义支持五层检查表。 |
| 参考现状 | 规范有/硬校验有缺口：严格规范已有，全部节点 ID 存在性与支持性未完整硬校验。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/F4_证据校验缺口.md` |

**按顺序走一遍：**

1. 逐层说明每种检查能证明什么。
2. 走两条无效引用反例，不替换或补造证据。
3. 将机械可检与仍需人工判断的条件分开。

**完成标准：**

- 能解释 ID 有效与因果正确不等价。
- 每个缺口关联后续验收任务。
- 尚未实现的修复保持待新增。

**一定要解释的失败反例：** 自动把 n99 替换成最近的真实节点，制造伪证据。

**可选来源核对：**

- [source-reference/attribution/llm_classifier.py](../../source-reference/attribution/llm_classifier.py)
- [source-reference/attribution/developer_source_attribution_spec.md](../../source-reference/attribution/developer_source_attribution_spec.md)
- [source-reference/attribution/development_priority.py](../../source-reference/attribution/development_priority.py)

## 阶段 G：从合格问题到治理顺序与代表案例

先准入，再排序和选样，三种决策不互相替代。

<a id="g1"></a>

### G1 内部开发榜准入与问题泳道

**目标：** 明确有无资格进入内部榜，而非仅计算高低分。

**为什么在这一步做：** 高频或高影响不能弥补无效证据。

**前置：** F4、E4。关联教材：[E09](../book/index.html#E09)、[E10](../book/index.html#E10)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 双结论、证据与源码可解决性。 |
| 输出 | 内部正式项、外部依赖、用户输入、配置、复核及潜在机会分流。 |
| 参考现状 | 参考部分具备：规范硬门禁比当前分值/排除门禁更严格。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/G1_准入表.md` |

**按顺序走一遍：**

1. 解释七类严格准入条件与各去向。
2. 构造高分但证据无效的候选。
3. 逐项对照当前实现缺少的硬审核。

**完成标准：**

- 不合格项目有原因和去向。
- eligible=true 不被当成全部合同成立。
- 不为凑榜强制补模块。

**一定要解释的失败反例：** 引用不存在节点却因高频被放进正式开发 Top5。

**可选来源核对：**

- [source-reference/attribution/developer_source_attribution_spec.md](../../source-reference/attribution/developer_source_attribution_spec.md)
- [source-reference/attribution/development_priority.py](../../source-reference/attribution/development_priority.py)

<a id="g2"></a>

### G2 分解四维开发优先分

**目标：** 解释合格问题为何这样排，而非把分值当概率。

**为什么在这一步做：** 治理资源有限，需要清楚且可调整的偏好。

**前置：** G1、E2。关联教材：[E10](../book/index.html#E10)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 可解决性、证据、影响与去重频率。 |
| 输出 | 一组可手算分项、总分及策略取舍说明。 |
| 参考现状 | 参考源码可见：45/30/15/10权重及模块先验存在，未证明业务最优。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/G2_评分分解.md` |

**按顺序走一遍：**

1. 手算 80/90/60/20 的示例并注明非运行结果。
2. 比较高频外部与低频明确内部问题。
3. 讨论权重变化可能牺牲哪些问题的优先级。

**完成标准：**

- 能分解总分及每项作用。
- 计数单位与频率变换说清楚。
- 不宣称74分等于74%根因正确。

**一定要解释的失败反例：** 把业务偏好权重写成已验证通用最优算法。

**可选来源核对：**

- [source-reference/attribution/development_priority.py](../../source-reference/attribution/development_priority.py)

<a id="g3"></a>

### G3 类别内签名、严重度与根因收敛

**目标：** 分清文本模式、单次后果和影响范围。

**为什么在这一步做：** 最高频不一定最严重，文本相近也不保证同因。

**前置：** G1、E2。关联教材：[E11](../book/index.html#E11)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 同类别多种报错、影响状态与任务身份。 |
| 输出 | 至少两簇的签名、任务数、严重度依据和排序。 |
| 参考现状 | 参考部分具备：签名、严重度与对数频次实现存在，风险词和空候选处理有边界。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/G3_收敛案例.md` |

**按顺序走一遍：**

1. 解释归一化如何去随机噪声且可能合并不同机制。
2. 手算 S2 三任务与 S4 一任务。
3. 走风险词引用、空输入和全部低置信反例。

**完成标准：**

- 与四维开发分区分用途。
- 严重度有后果证据，不只看关键词。
- 无合格簇时不自动认定首项正确。

**一定要解释的失败反例：** 说明文字出现数据丢失就认定实际发生不可逆损害。

**可选来源核对：**

- [source-reference/attribution/cause_convergence.py](../../source-reference/attribution/cause_convergence.py)
- [source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md](../../source-reference/attribution/ASSUMPTIONS_SINGLE_TRACE.md)

<a id="g4"></a>

### G4 比较两套代表案例算法

**目标：** 根据展示目标解释选谁，不混称同一算法。

**为什么在这一步做：** 最常见文本未必有足够证据，最长轨迹可能只是噪声。

**前置：** G2、G3。关联教材：[E12](../book/index.html#E12)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 候选簇中的真实样本、文本与证据完整度。 |
| 输出 | 文本典型性与可调试性对照表，保留选样依据。 |
| 参考现状 | 参考源码可见：TF-IDF余弦medoid与频率/签名/完整度分层选择均存在。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/G4_选样取舍.md` |

**按顺序走一遍：**

1. 用三样本距离解释中心真实样本。
2. 按分层规则走类别、主流签名、完整度。
3. 讨论证据门禁和大簇成对比较成本。

**完成标准：**

- 能说明两种选择目标不同。
- 不以真实样本代表归因必然正确。
- Trace频率和任务频率各按入口说明。

**一定要解释的失败反例：** 将最长 Trace 当成无需审核的最佳根因证据。

**可选来源核对：**

- [source-reference/attribution/cause_convergence.py](../../source-reference/attribution/cause_convergence.py)
- [source-reference/attribution/representative_case_selector.py](../../source-reference/attribution/representative_case_selector.py)

## 阶段 H：交付报告、指标与实验证据

使分析结果可用于排查，并让数字始终带有范围、单位和来源。

<a id="h1"></a>

### H1 汇总、问题、Case 与节点审计链

**目标：** 报告每条结论能够回到具体输入。

**为什么在这一步做：** 图表和标签不足以让开发者确认应该改哪里。

**前置：** G4。关联教材：[E13](../book/index.html#E13)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 已判定结果、任务身份与证据来源。 |
| 输出 | 一页总览和一条完整可回溯 Case。 |
| 参考现状 | 参考部分具备：多种聚合与Case脚本存在，尚未统一入口和任务口径。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/H1_审计报告草图.md` |

**按顺序走一遍：**

1. 从总览进入一个日期错误案例。
2. 逐字段补身份、直接原因、内部候选、证据和反事实。
3. 检查各数值到底是行数、事件还是任务。

**完成标准：**

- 候选不会在标题中升级为确认根因。
- 缺证据与裁剪事实保留。
- 机器和人工视图共享口径。

**一定要解释的失败反例：** 图表显示100个问题，却无法说明单位和原始证据。

**可选来源核对：**

- [source-reference/attribution/aggregator.py](../../source-reference/attribution/aggregator.py)
- [source-reference/attribution/high_frequency_case_report.py](../../source-reference/attribution/high_frequency_case_report.py)
- [source-reference/attribution/references_reporting_spec.md](../../source-reference/attribution/references_reporting_spec.md)

<a id="h2"></a>

### H2 分开多轮报表与正式交付范围

**目标：** 选一条明确的报告链，避免把文件数量当产品完整度。

**为什么在这一步做：** 一套脚本的结果不能随意供另一版本模板消费。

**前置：** H1、D1。关联教材：[E13](../book/index.html#E13)、[E15](../book/index.html#E15)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 不同报表输入格式、模板合同和来源版本。 |
| 输出 | 选用入口/输出与非本轮目标清单。 |
| 参考现状 | 参考部分具备：旧主入口、推荐结构化入口和固定模板并存，未合为当前可运行应用。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/H2_报表范围.md` |

**按顺序走一遍：**

1. 讲内容合同与视觉模板的责任区别。
2. 对照两个入口需要哪些中间字段。
3. 首轮个人工具明确只做JSON/Markdown，不复刻全部Excel样式。

**完成标准：**

- 知道哪些脚本是替代或后续版本。
- 不声称全部旧脚本已经串好。
- 外围格式不挤占因果和口径理解。

**一定要解释的失败反例：** 不同版本中间表字段不一致，却宣称一键生成正式日报。

**可选来源核对：**

- [source-reference/attribution/DELIVERY_README.md](../../source-reference/attribution/DELIVERY_README.md)
- [source-reference/attribution/references_reporting_spec.md](../../source-reference/attribution/references_reporting_spec.md)
- [source-reference/attribution/badcase_analysis.py](../../source-reference/attribution/badcase_analysis.py)

<a id="h3"></a>

### H3 定义Latency、TTFT、成本和最差样本

**目标：** 能用时间线和缺失样例解释数字。

**为什么在这一步做：** 不同粒度和缺失处理会让数字不可比。

**前置：** A2、H1。关联教材：[E14](../book/index.html#E14)。

| 对象 | 合同 |
| --- | --- |
| 输入 | Trace起止、Generation首Token、费用与时间窗。 |
| 输出 | 指标字典及已知费用/覆盖说明。 |
| 参考现状 | 已有文档：本包保留口径说明，三指标完整构建服务未作为核心运行模块纳入。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/H3_指标字典.md` |

**按顺序走一遍：**

1. 手算含两次模型和一次工具的时间线。
2. 三次生成一次费用未知，分别报告已知部分和调用覆盖。
3. 定义最差10%边界、样本过滤与零样本行为。

**完成标准：**

- TTFT不等于Trace总时长。
- 费用未知不填零。
- 24小时、30天与旧窗口按来源分开。

**一定要解释的失败反例：** 只分析坏例却把时延宣称全站总体性能。

**可选来源核对：**

- [docs/EXISTING_CODE_SPEC.md](../EXISTING_CODE_SPEC.md)

<a id="h4"></a>

### H4 登记版本、替身条件与复现实验

**目标：** 从历史机制提取可验证问题，不借用成绩。

**为什么在这一步做：** 代码存在和替身实验都不直接证明生产效果。

**前置：** B4、C3、H3。关联教材：[E15](../book/index.html#E15)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 原版/修订版、历史Mock/PGlite/存根条件。 |
| 输出 | 报告声称/源码可见/本轮实测/线上证据四栏卡及复现计划。 |
| 参考现状 | 已有文档：历史报告有条件和局限，本轮未重跑其服务与模型。 |
| 操作范围 | 以工程讲解、完整场景与纸面走查为主，不要求修改源快照 |
| 完成产物（拟存位置） | `docs/learning/build-records/H4_实验条件卡.md` |

**按顺序走一遍：**

1. 先对齐报告版本与源码变化。
2. 选预算或中断机制定义同条件实验。
3. 列目标故障与相关正常路径，保留代价与未验项。

**完成标准：**

- 每项历史数字都附条件和出处。
- 无真实Redis时不声称并发协调已验。
- 没有前后结果不填提升百分比。

**一定要解释的失败反例：** 把作者的Mock吞吐直接当本人真实模型优化成果。

**可选来源核对：**

- [source-reference/historical-analysis/README.md](../../source-reference/historical-analysis/README.md)
- [source-reference/runtime-original/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-original/src/server/services/agentRuntime/AgentRuntimeService.ts)
- [source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts](../../source-reference/runtime-reviewed/src/server/services/agentRuntime/AgentRuntimeService.ts)

## 阶段 I：自己的第一个确定性离线闭环

把选定合同做成真正可运行、可回归的个人增量，保持 source-reference 不变。

<a id="i1"></a>

### I1 冻结最小Spec、配置与测试基座

**目标：** 先让输入输出与无外部副作用的工程边界稳定。

**为什么在这一步做：** 复制旧入口会继承隐含依赖，先建边界才能明确个人改动。

**前置：** D4、E4、F4、G1、H2。关联教材：[E16](../book/index.html#E16)、[E17](../book/index.html#E17)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 已走通的身份、失败、双结论、证据与报告合同。 |
| 输出 | 最小开发Spec、src布局、固定测试入口和少量合同反例。 |
| 参考现状 | 个人待新增：当前没有个人src/tests/工程入口；以下文件与符号都是拟建。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/OFFLINE_V1_SPEC.md` |

**按顺序走一遍：**

1. Codex把A—H约定收敛成可实施Spec。
2. 定义配置、规范对象、错误类型与明确CLI参数。
3. 创建能验证导入无业务副作用和基本配置的测试基座。

**完成标准：**

- Spec说明输入输出、缺失行为和完成标准。
- 新增模块导入不读取密钥、不联网、不写不明目录。
- 测试有固定命令和实际记录；不是只有空目录。

**一定要解释的失败反例：** 刚import就初始化模型客户端或执行旧主入口。

**拟建文件（尚未实现）：**

- `pyproject.toml`
- `src/agent_eval/config.py`
- `src/agent_eval/models.py`
- `tests/test_config.py`

**拟建接口（不是现有函数声明）：** `load_config(path)`、`NormalizedTrace / FailureEvent / AttributionCandidate`。

**可选来源核对：**

- [docs/EXISTING_CODE_SPEC.md](../EXISTING_CODE_SPEC.md)
- [source-reference/attribution/developer_source_attribution_spec.md](../../source-reference/attribution/developer_source_attribution_spec.md)

<a id="i2"></a>

### I2 实现JSONL适配与确定性失败事件

**目标：** 合成输入可以形成有来源身份的规范轨迹和失败事件。

**为什么在这一步做：** 适配和事件事实是后续责任校验的共同基础。

**前置：** I1。关联教材：[E04](../book/index.html#E04)、[E05](../book/index.html#E05)、[E06](../book/index.html#E06)、[E17](../book/index.html#E17)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 合法行、坏行、乱序返回、重复采集和模糊结果。 |
| 输出 | 规范对象、接收统计、明确失败/未知事件。 |
| 参考现状 | 个人待新增：借鉴参考处理思路，新增独立实现，尚未编码。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/results/I2_适配验收.json` |

**按顺序走一遍：**

1. 实现逐行接收与原始位置保留。
2. 按ID关联调用，执行明确失败合同并保留未知。
3. 用独立预期检查重复、孤立返回与计数，不调用旧脚本。

**完成标准：**

- 至少覆盖成功含error、明确失败、坏行、孤立结果和重复。
- 原始行与规范节点能互查。
- 字段回退有标记，不伪造task或session。

**一定要解释的失败反例：** 坏行被静默跳过导致报告分母不完整。

**拟建文件（尚未实现）：**

- `src/agent_eval/adapter.py`
- `src/agent_eval/detector.py`
- `tests/test_adapter.py`
- `tests/test_detector.py`

**拟建接口（不是现有函数声明）：** `read_jsonl(path)`、`normalize_trace(record)`、`detect_failures(trace)`。

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/trace_denoiser.py](../../source-reference/attribution/trace_denoiser.py)

<a id="i3"></a>

### I3 实现严格证据门禁与责任分流

**目标：** 无效证据不能靠分数进入内部正式榜。

**为什么在这一步做：** 把事实资格从启发式排序中独立出来，避免伪证据被放行。

**前置：** I2、F4、G1。关联教材：[E08](../book/index.html#E08)、[E09](../book/index.html#E09)、[E10](../book/index.html#E10)、[E17](../book/index.html#E17)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 规则候选、规范节点、模块词表与反事实字段。 |
| 输出 | 准入或待复核结果、逐项原因与内外部双结论。 |
| 参考现状 | 个人待新增：个人增量候选：补引用校验与硬门禁；语义支持仍需明确限制。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/results/I3_证据门禁验收.json` |

**按顺序走一遍：**

1. 实现候选到统一结果的接口，不在此引入真实LLM。
2. 检查ID存在、模块、字段一致和明确合同条件。
3. 用n99、真实但不支持、纯外部、外部加内部治理反例回归。

**完成标准：**

- 不存在引用被拒绝且不自动改成其他节点。
- 纯外部故障不误归内部，内部治理候选可独立记录。
- 机械通过不宣称语义已被完全证明；未确定进入复核。

**一定要解释的失败反例：** 候选分很高，缺乏最早内部异常仍被正式确认。

**拟建文件（尚未实现）：**

- `src/agent_eval/rules.py`
- `src/agent_eval/validator.py`
- `tests/test_validator.py`

**拟建接口（不是现有函数声明）：** `build_candidate(trace, event)`、`validate_candidate(candidate, trace)`。

**可选来源核对：**

- [source-reference/attribution/developer_source_attribution_spec.md](../../source-reference/attribution/developer_source_attribution_spec.md)
- [source-reference/attribution/llm_classifier.py](../../source-reference/attribution/llm_classifier.py)
- [source-reference/attribution/development_priority.py](../../source-reference/attribution/development_priority.py)

<a id="i4"></a>

### I4 实现任务去重、CLI与双格式审计报告

**目标：** 从一个指定输入文件得到稳定可核查的完整输出。

**为什么在这一步做：** 把独立模块连起来，才可检验字段与口径是否在边界丢失。

**前置：** I3、E2、H1。关联教材：[E06](../book/index.html#E06)、[E13](../book/index.html#E13)、[E17](../book/index.html#E17)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 合成JSONL与固定配置。 |
| 输出 | 事件、Trace、任务计数，JSON与Markdown报告，运行状态。 |
| 参考现状 | 个人待新增：JSON/Markdown个人统一报告尚未实现。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/results/I4_端到端验收.md` |

**按顺序走一遍：**

1. 按准入结果聚合并保留所有分流原因。
2. 让两份报告来自同一结果对象，显示节点与原始位置。
3. 建立端到端命令，重复运行比较稳定业务结果与明确运行元数据。

**完成标准：**

- 至少五类案例完整跑通并有原始结果。
- 2次重试保持2事件/1任务，重复采集不再加事件。
- JSON与Markdown计数一致、证据可回查，失败退出行为明确。

**一定要解释的失败反例：** 单元测试通过，主入口却丢复核项或改变计数。

**拟建文件（尚未实现）：**

- `src/agent_eval/aggregate.py`
- `src/agent_eval/report.py`
- `src/agent_eval/cli.py`
- `tests/test_offline_e2e.py`

**拟建接口（不是现有函数声明）：** `aggregate_results(results)`、`write_report(result, output_dir)`、`main(argv)`。

**可选来源核对：**

- [source-reference/attribution/aggregator.py](../../source-reference/attribution/aggregator.py)
- [source-reference/attribution/references_reporting_spec.md](../../source-reference/attribution/references_reporting_spec.md)

## 阶段 J：评测、改进对照与可演示交付

让新增能力有真实证据，再形成项目表达；模型扩展不阻塞首轮收口。

<a id="j1"></a>

### J1 人工核对样例与指标分母

**目标：** 使用独立合同标签衡量判断和证据，而非复制程序答案。

**为什么在这一步做：** 没有可信标签，准确率数字没有依据；全弃权也不能冒充高质量。

**前置：** A4、H3、I4。关联教材：[E16](../book/index.html#E16)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 五类场景与配对反例、人工核对依据。 |
| 输出 | 版本化样例、标签说明、开发/独立检查划分与指标定义。 |
| 参考现状 | 个人待新增：尚未形成独立人工核验评测集；先10条，再按时间扩展30—50条。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/evaluation/DATASET_CARD.md` |

**按顺序走一遍：**

1. Codex准备候选，用户分批核对关键标签。
2. 分别定义内部精确率、召回、非内部误报、引用有效与覆盖/弃权。
3. 保留分歧和版本，小样本限制直接写入结果。

**完成标准：**

- 至少10条标签有理由和支持节点。
- 开发反例与检查样例用途区分。
- 未知/弃权分母不被隐去。

**一定要解释的失败反例：** 为适配实现更改全部标签，再宣布泛化有效。

**拟建文件（尚未实现）：**

- `tests/fixtures/offline_cases.jsonl`
- `tests/fixtures/expected_labels.json`
- `docs/implementation/evaluation/METRICS.md`

**可选来源核对：**

- [docs/EXISTING_CODE_SPEC.md](../EXISTING_CODE_SPEC.md)

<a id="j2"></a>

### J2 基线、严格合同与修复回归对照

**目标：** 证明一项个人增量改善什么，也记录代价和无提升。

**为什么在这一步做：** 不执行旧副作用入口，也能按明确规则重建比较基线；必须说明比较对象。

**前置：** J1、I4。关联教材：[E15](../book/index.html#E15)、[E16](../book/index.html#E16)、[E17](../book/index.html#E17)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 固定样例、规则配置、可说明的离线基线与严格实现。 |
| 输出 | 同口径原始结果、缺陷案例、指标和回归说明。 |
| 参考现状 | 个人待新增：旧缺口已静态识别，未产生本轮前后实验结果。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/evaluation/BASELINE_COMPARISON.md` |

**按顺序走一遍：**

1. 固定数据、标签、配置和版本。
2. 比较宽松候选/严格门禁的误报、覆盖和证据变化。
3. 检查修复相关正常路径，记录未改善与性能代价。

**完成标准：**

- 每个数值能回到真实结果和分母。
- 基线若是新建教学复现则明确标注。
- 不把拒绝更多样例单独描述为准确率提升。

**一定要解释的失败反例：** 换数据、换分母后把差异全归于新算法。

**拟建文件（尚未实现）：**

- `src/agent_eval/evaluate.py`
- `tests/test_regression_cases.py`

**可选来源核对：**

- [source-reference/attribution/structured_jsonl_attribution.py](../../source-reference/attribution/structured_jsonl_attribution.py)
- [source-reference/attribution/llm_classifier.py](../../source-reference/attribution/llm_classifier.py)
- [source-reference/attribution/development_priority.py](../../source-reference/attribution/development_priority.py)

<a id="j3"></a>

### J3 可选：真实模型对照与成本边界（可选）

**目标：** 在同一合同下判断模型是否提供值得付费的语义收益。

**为什么在这一步做：** 提示词文件不能证明LLM能力，真实接口也不能绕过证据校验。

**前置：** J1、J2。关联教材：[E08](../book/index.html#E08)、[E14](../book/index.html#E14)、[E16](../book/index.html#E16)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 允许处理的样例、明确接口/预算、同一评测集。 |
| 输出 | 规则与规则加模型的质量/覆盖/调用/成本对照。 |
| 参考现状 | 可选/未验证：非首轮必做；需明确模型接口、预算和允许材料后才实施。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/evaluation/OPTIONAL_LLM_COMPARISON.md` |

**按顺序走一遍：**

1. 有条件时再定义独立模型适配层和失败预算。
2. 输出经过同一机械门禁与人工抽查。
3. 比较收益、额外成本和接口失败，记录采用或不采用理由。

**完成标准：**

- 运行前有允许材料和预算。
- 未执行就标未验，不填模型准确率。
- 同数据同标签同校验合同。

**一定要解释的失败反例：** 仅写Prompt就宣称真实模型归因已验证。

**拟建文件（尚未实现）：**

- `src/agent_eval/model_adapter.py`

**可选来源核对：**

- [source-reference/attribution/llm_classifier.py](../../source-reference/attribution/llm_classifier.py)

<a id="j4"></a>

### J4 固定演示、真实记录与项目讲述

**目标：** 能从业务问题演示到证据报告，并解释自己的真实增量。

**为什么在这一步做：** 工程实现、学习理解和面试表达都需要可回查依据。

**前置：** J2。关联教材：[E18](../book/index.html#E18)。

| 对象 | 合同 |
| --- | --- |
| 输入 | 固定离线版本、配置、示例和评测结果。 |
| 输出 | 演示步骤、贡献边界表、90秒/3分钟介绍及薄弱清单。 |
| 参考现状 | 个人待新增：教材和来源包已有；个人应用交付仍依赖I/J任务真实完成。 |
| 操作范围 | 个人新增/验证，按拟建Spec实施；本次只规划 |
| 完成产物（拟存位置） | `docs/implementation/DELIVERY_AND_DEMO.md` |

**按顺序走一遍：**

1. 按固定输入演示一次失败和一条反例。
2. 逐项说明参考、教学重建、个人新增与实际验证。
3. 做一轮真实模拟面试，按回答记录缺口，不预造分数。

**完成标准：**

- 另一环境按说明能跑选定个人闭环，或明确未复测范围。
- 介绍中的每个数字和我做了都有证据。
- 没有倒签提交、虚构事故或借用历史成绩。

**一定要解释的失败反例：** 把阅读、参考代码存在与本人从头开发混成一段经历。

**拟建文件（尚未实现）：**

- `README.md`
- `docs/implementation/CONTRIBUTIONS.md`
- `docs/implementation/DEMO.md`

**可选来源核对：**

- [docs/book/lessons/00_项目总介绍.md](../book/lessons/00_项目总介绍.md)
- [SOURCE_MANIFEST.json](../../SOURCE_MANIFEST.json)
- [docs/EXISTING_CODE_SPEC.md](../EXISTING_CODE_SPEC.md)

