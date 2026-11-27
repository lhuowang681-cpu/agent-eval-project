# 实验索引

围绕诊断链路集成、规则与证据审核对照、真实模型输出三个方向组织实验。

| 目录 | 实验内容 | 结果入口 |
| --- | --- | --- |
| [postgres-acceptance](postgres-acceptance/README.md) | PostgreSQL 联调、ModelRuntime 适配与 40 例合成数据对照 | [联调回归](postgres-acceptance/REGRESSION_REPORT.md)、[规则与审核对照](postgres-acceptance/BASELINE_SHADOW_COMPARISON.md) |
| [model-smoke](model-smoke/README.md) | 6 次真实模型请求、三个 Prompt 版本及逐次审核分析 | [模型结果](model-smoke/RESULTS.md) |
| [model-smoke-v1](model-smoke-v1/README.md) | 首轮接口校验、前序输入与共享调用账本 | [首轮校验](model-smoke-v1/PROVIDER_REAL_VALIDATION.md) |

从仓库根执行 `python -B scripts/check.py`，运行 sidecar、指标计算和已有模型输出的三组离线测试，共 24 项。

实验目录包含数据协议、配置、冻结快照、原始输出与分析报告。目录对应关系见[仓库结构说明](../docs/REPOSITORY_LAYOUT.md)。
