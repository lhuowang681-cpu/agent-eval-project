# 输出级有限观察复核

已逐条裁决INPUT.json的30份规范事故观察，保存DECISIONS.json：correct=true/supported=true共18条，correct=null/supported=null共12条；没有强制将歧义判错，也没有把null记成正确。每条包含具体被引字段/类别说明及categoryExactMatch。

输入SHA256：`9dd348c6d6f58a15a2a4a524fb426bd926ecaa44f59e60b5e5180b090bbc2915`。裁决后输入字节未变。独立stdlib检查发现所有引用节点和quote均存在，记录在REFERENCE_CHECKS.json；这仅证明存在性，语义支持另行逐条判断，未调用审核器或分类器。

本次只读取供裁决INPUT.json，没有读取MAP.json、实验results、原始holdout文件或优化算法，没有改输入、oracle或算法。由于未获取方法映射，不计算方法间提升或整体准确率。

## 保留的类别边界歧义

以下12条原字段确有失败且有更具体信号，但输出generic/unclassified类别不在oracle列出的类别中；INPUT未给出两者的上位/兜底包含合同，不能因“有失败”就认定这个exact类别正确，也不能擅自判粗粒度观察为假。

- claim-011、014、022、023、026、028：TimeoutError、503、403、token_expired等具体外部失败，输出external_tool_failure；oracle分别列timeout/transport/permission/credential。
- claim-013、015、019、024、027、030：参数JSON/schema、无runtime/executor、结果JSON解析等具体Builtin失败，输出builtin_tool_failure_unclassified；oracle列contract_invalid/unavailable/result_parse_failed。

以上correct与supported都保留null，categoryExactMatch=false。原标签未改；这些不是已证明的错误类别，也不进入正确数。categoryExactMatch是精确列表匹配，不代替事实真值。

其余18条被引原error或顶层失败结果与有限类别一致；必要的call/source可定位。其中缺父图或operation事件的观察仍可由本节点失败字段支持，但不会据此认定原始责任模块；后续无关天气成功也不撤销已经发生的失败。全体输出moduleId=null，本次没有给任何root cause正确性加分。

## 限制

这是`internal-agent-not-human-gold`内部代理复核，不是独立人工gold。审阅者有历史项目上下文，trajectory/case名称可见；只是移除了方法名和审核结论，不是完全双盲。所有30条oracle均eligible=true，不能外推未提供负例上的错误率、完整诊断覆盖或真实模型质量。

correct评价给定有限类别/摘要的事实可判定性，supported评价当前实际引用是否足够；本批二者恰好同值，不将二者定义成一般等价关系。判断以给定source为证据，不证明合成轨迹的生产真实性。自由摘要的规范化或模块弃权，不等于原LLM根因正确。后续统计应保留null及类别粒度歧义，且不据本裁决回调已冻结算法。
