# Failure Grouping与治理优先级

历史cause_convergence.converge按signature归组并取组内最高severity，TF-IDF medoid代表获胜组。该脚本实际在本轮作为Baseline执行（需已有numpy），源Hash和完整输出保存在grouping.json；没有把历史工具说成线上能力。

新模块三层：单次事件以Run/Case/Thread/ToolCall/Event身份去重；跨执行按signature/source/tool/operation/environment/errorContext形成Failure Pattern；共同根因仍为None、hypothesesStatus=unconfirmed。同样Timeout可以属于多个机制，缺环境上下文时保守隔离，不把Unknown当相同机制。相同身份不同内容会报冲突，不静默覆盖。

合成集102个唯一事件，另重复1个，共103条。历史算法得到一个tool_timeout组、最高S5、102个session；新模块得到3个模式，不跨工具和错误上下文混合。主模式100任务/100事件/101原始记录：99自动恢复，恢复率99%；1任务最终失败，失败率1%；severity分布S1=99、S5=1；典型严重度S1、最大S5。不是用“最高S5”代表所有事件。

统计保留原始/去重事件、去重执行任务、恢复数、失败数/率、未知终态、严重度分布/中位数/最大值、证据质量分布。任务去重粒度为Run+Case+Thread（一次评测执行），不能误称跨Run唯一业务Case数。恢复率当前假定输入recovered为有效布尔，未知/缺失恢复字段的独立分母尚未实现；不适合直接吃未经校验生产日志。终态冲突任务单列unknown，不擅自判最终失败。

三类代表：TF-IDF余弦medoid保留“最典型”；按证据质量再严重度取“最易排查”；另保留“最严重”。本轮标准库TF-IDF与历史numpy实现具体权重不完全相同，未证明代表选择质量提升；不引入Embedding/LLM。保留算法价值而非盲目替换。

优先级为两条行动建议：Agent源码修复需先有责任证据，不把工具超时直接归责源码；MCP/plugin稳定性仍建议重试、降级、替换或运维处理。未校准跨组金额损失/业务权重，故不伪造数值排序优越性，分布供人工决策。当前不存在生产排序策略接入。

局限：人工构造、未知真实共同根因、重复身份由上游提供；未验证大规模性能、事件自动导出或事故真实成本。只推荐作为离线分析原型，不推广为自动根因聚类和生产优先级引擎。回滚为停止调用模块，原历史脚本与诊断链均未修改。
