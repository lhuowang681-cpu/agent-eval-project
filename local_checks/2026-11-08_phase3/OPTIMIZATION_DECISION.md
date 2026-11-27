# 冻结的有限优化方案

本方案在主实现者读取holdout具体输入/标签前冻结。依据只读存量审计与开发反例，选择两个方向；不改既有纯分类函数、标签、评分、任务合同或原Trace提取。

1. **结论范围与覆盖匹配**：完整Trace仍是确认内部根因的必要但不充分条件；当前DB合同的内部module/root_cause声明仍全部拒绝。对有已知来源、原始故障及合法引用的有限observation，移除`coverage.complete`一票否决，保留coverage和warnings原样，不宣称全链完整。解决真实HTTP计算器和旧missing_parent的已证误拒。
2. **引文支持匹配**：不仅验证引文存在，还在仅含被引字段/片段的节点副本上重新检查类别，并要求与原节点类别一致。content观察须有明确执行失败标志；顶层success/ok=true或只有业务嵌套success=false，不能作为执行失败。避免成功content借未引用error、业务失败借执行失败概念通过。纯规则Baseline保留原样，暴露其限制。

摘要逐字白名单暂不改。任意自然语言因果摘要没有可靠语义检查，本轮拒绝用正则黑名单或简单阈值替代；正确改写仍会错拒，作为未解决问题公开。多故障category=null仍弃权，后续需另定多结论合同，不在此轮扩展。

调用链：review_candidate→audited_candidate→review_cli / adapter.analyze_reviewed→固定Python子进程→原TS归因worker。仅修改review_candidate和新增纯辅助函数，现有JSON输入输出形状不变，engine revision按代码内容自动变化。engine-version和README同步记录语义版本。GitNexus旧索引无这些符号，risk UNKNOWN原始输出在audit/IMPACT.json；静态调用点已核对，不视为LOW证明。

原版保存baseline/并有SHA；新红绿回归先验证两个误拒/错误接受。独立holdout由另一作者手工构建且不调用审核器；方案/实现冻结后一次性跑，不据holdout结果再调算法。若性能没提升、仍错拒或出现残余错误接受，保留并报告，不继续调参。
