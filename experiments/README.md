# 实验索引

| 目录 | 主题 | 结果入口 |
| --- | --- | --- |
| [postgres-acceptance](postgres-acceptance/) | 真实数据库联调与 40 例合成离线对照 | [回归总账](postgres-acceptance/REGRESSION_REPORT.md)、[规则/审核对照](postgres-acceptance/BASELINE_SHADOW_COMPARISON.md) |
| [model-smoke](model-smoke/) | 最新 6 次真实模型开发请求的版本比较与离线分析 | [结果](model-smoke/RESULTS.md) |
| [model-smoke-v1](model-smoke-v1/) | 前序 Smoke、失败输入及共享预算账本 | [说明](model-smoke-v1/README.md) |

这些是不同范围的历史实验，不将测试、样本或调用数量累加成统一质量成绩。运行 `python -B scripts/check.py` 可从仓库根进行离线检查；该命令不请求模型。

目录已适配当前布局；历史报告与冻结清单保留原记录。严格复现当时环境和哈希，请参阅[归档与路径说明](../docs/REPOSITORY_LAYOUT.md)。
