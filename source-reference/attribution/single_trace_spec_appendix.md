## Top5 类别内根因严重度×频率收敛（5→1）

### 原则
语义判断交给大模型，数值计算交给确定性代码。大模型仅归纳互斥根因及判断固有严重度；代码负责 trace→cause 分配、去重 Session 计数、评分、胜出选择和 medoid。禁止让模型统计频率。

### 流程
1. 对每个 Top5 类别的去重错误签名/代表 Trace 使用子提示词 A 归纳 `cause_id`、名称和机械判别信号。
2. 代码在全量 Trace 上按判别信号分配唯一 `cause_id`，无法匹配归 other。
3. 使用子提示词 B 对全部 cause 判断 S1–S5 固有严重度，不提供频率字段；支持人工锚点 few-shot。
4. 统计“频率（受影响的去重用户任务数）”：当前数据用去重 `effective_trace_id/topic_id` 表示不同用户任务，内部字段保留为 `n_sessions`；计算 `score = severity_weight × log2(1+n_sessions)`。同一任务内的重复报错、重试和传播节点只计 1 次。
5. 默认 argmax 选胜出 cause；分差 <5% 时严重度权重优先；低于 0.6 置信度不自动定胜负；不可逆尾部进入高危必看。
6. 在胜出 cause 的真实 Trace 集合中选 medoid，每类最终只输出一条。

### 设计理由
- 乘法要求严重度和覆盖面同时不低，避免高频低危完全挤掉低频高危。
- 严重度使用 1/2/4/8/16 几何刻度，保证严重问题在乘法中有足够区分度。
- 频率用 log2 压缩长尾动态范围，避免退化为纯频率排序。
- Session 去重衡量用户波及面，而不是日志条数。

### 配置
`confidence_threshold=0.6`、`tie_tolerance=0.05`、`frequency_method=log2|power`、`beta=0.5`。

### 输出扩展字段
`cause_id, cause_name, discriminating_signals, severity_level, severity_weight, has_irreversible_tail, severity_confidence, n_sessions, score, high_risk, needs_review, medoid_trace_id, medoid_method`。
