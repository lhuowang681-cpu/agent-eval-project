# 真实模型Smoke已执行：首条失败后停止

已使用用户此前提供的DeepSeek凭据，实际请求1次、HTTP200、736 Token。候选JSON缺少scope/inputDigest，被结构校验拒绝。剩余5条Smoke及40例正式实验未运行，Shadow继续关闭。

先看PROVIDER_REAL_VALIDATION.md、COST_AND_LATENCY.md、EXPERIMENT_RESULTS.md、FINAL_DECISION.md。原始脱敏响应在results/real-smoke.json，逐例状态在smoke-cases.csv，裁决在SMOKE_VERDICT.json。

FREEZE/RUN_FREEZE、BUDGET_REQUEST、EXPERIMENT_PROTOCOL及readiness为调用前记录，保留原样；最新授权在BUDGET_AUTHORIZATION，实际次数在paid-smoke-ledger。不得删账本、覆盖结果或自动消耗剩余次数。

GOLD_REVIEW及逐例gold/REVIEW保留40例原标签和审查意见：单作者、部分任务带诊断提示，不是严格独立人工Gold。不能用旧Mock结果冒充真实模型效果。

密钥仅隐藏输入并传给子进程，交付不含凭据。原平台/Prompt/审核/Gold与调用前Hash一致。供应商实际账单未核验，估算见成本报告。原配置和脚本保留供审计；没有通过修改合同、自动补字段来放行本次失败。
