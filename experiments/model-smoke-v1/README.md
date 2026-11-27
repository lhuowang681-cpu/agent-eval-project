# 首轮真实模型接口校验

通过 DeepSeek 与 ModelRuntime 完成首轮真实请求，记录 HTTP 响应、候选 JSON、用量与审核裁决。此次调用返回 HTTP 200，使用 736 Token；结构校验识别出缺少 scope / inputDigest，并记录拒绝结果。

## 已完成工作

- 实现真实供应商请求与结构化候选处理。
- 验证任务身份字段的完整性校验。
- 保存脱敏响应、逐例状态、Token 与延迟记录。
- 建立实验协议、输入快照和共享调用账本，供[后续 Prompt 迭代](../model-smoke/README.md)使用。

## 阅读入口

- [供应商接口校验](PROVIDER_REAL_VALIDATION.md)
- [成本与延迟](COST_AND_LATENCY.md)
- [实验结果](EXPERIMENT_RESULTS.md)
- 原始输出：`results/real-smoke.json`
- 逐例状态：`smoke-cases.csv`
- 审核裁决：`SMOKE_VERDICT.json`

后续六次请求的综合分析见 [model-smoke/RESULTS.md](../model-smoke/RESULTS.md)。
