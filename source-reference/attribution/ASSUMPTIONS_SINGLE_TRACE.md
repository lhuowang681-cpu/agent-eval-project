# 假设与待确认清单

1. **频率统计单位**：面向人的名称统一为“频率（受影响的去重用户任务数）”。源文件 README 说明 `effective_trace_id = topic_id`，且原始 `trace_id` 为 DBNULL.value；当前以去重 `effective_trace_id/topic_id` 表示不同用户任务。真实 `session_id` 仅部分节点有值，不用于当前主频率。内部兼容字段仍名为 `n_sessions`。
2. **可机械匹配字段**：当前使用 `error_type/error_message/error_raw`、Tool 名称/输入/输出、归因 reason/evidence、Trace 摘要进行判别信号匹配。
3. **LLM 可用性**：当前没有配置外部兼容 LLM 凭证，所以没有实际调用子提示词 A/B；改用确定性错误签名形成 cause，并用影响状态锚点判严重度。两个完整提示词已内置，未来接入 LLM 时可替换语义步骤，但不得替换代码计数和评分。
4. **Embedding 可用性**：当前没有外部 embedding 服务。Medoid 使用本地 TF-IDF + 余弦距离，保持可复现。未来可配置 embedding，但需保留相同 medoid 定义和审计输出。
5. **严重度适配**：硬失败锚定 S4，已恢复能力问题锚定 S2；出现真实不可逆资金/数据/安全证据才升至 S5。该规则不考虑频率。
6. **类别 Top5**：继续沿用当前 Agent 编排内可解决问题类别的去重 Trace 频率 Top5，不改变类别层选取逻辑；严重度×频率仅用于类别内部根因 5→1 收敛。
7. **图表**：当前保留上一版已对齐的四张图。图表仍表示类别/模块/场景的整体统计，不改成根因收敛图。
