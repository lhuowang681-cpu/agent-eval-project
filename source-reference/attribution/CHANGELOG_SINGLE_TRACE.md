# Changelog：Top5 每类 5→1 收敛

- 保留 Agent 编排内可解决问题 Top5 类别的确定性频率统计。
- 每个类别先按判别信号形成互斥 `cause_id`，全程作为 join key。
- 增加严重度 S1–S5 与几何权重 1/2/4/8/16。
- 增加确定性评分：`severity_weight × log2(1+n_sessions)`。
- 增加 5% 平局时严重度优先、不可逆尾部高危必看、置信度低于 0.6 人工复核。
- 每类胜出根因只输出 1 条真实代表 Trace。
- 代表 Trace 使用本地 TF-IDF + 余弦距离 medoid，避免取最新或最严重个例。
- Case 数由 25 收敛为 5；每个 Case 保留主表 Trace 证据链、RULES、TRACE_AUDIT。
- 00_CHARTS 保留四张既有对齐图表。
- 新增 `convergence_audit.json`，记录所有根因评分、胜出原因、高危和复核项。
