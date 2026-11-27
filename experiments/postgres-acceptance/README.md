# PostgreSQL 联调与诊断对照实验

完成 PostgreSQL、tRPC、异步 Worker 和 Python 诊断服务的链路验证，并通过 ModelRuntime 适配器对接结构化候选与证据审核。配套构建 40 例合成轨迹，比较原规则、增强规则和独立审核的输出。

## 已完成工作

- 11 个数据库联调场景，覆盖应用路由、消息读取、轨迹提取、任务调度、Worker 处理、诊断落库和用户隔离。
- 评分与归因 TypeScript 子树 225 项测试通过，覆盖 21 个文件。
- ModelRuntime HTTP Mock 与 Python 审核完成 10 项检查。
- 40 例合成数据 × 3 种方法，保存 120 行逐例对照结果。
- 证据审核过滤 3 条错误观察、保留 25 条正确观察，正常 / 恢复误报为 0 / 14。

## 离线检查

从仓库根运行全部三组检查：

```bash
python -B scripts/check.py
```

单独运行本实验的 4 项指标测试：

```bash
cd experiments/postgres-acceptance
python -B test_quality.py
```

## 源码与结果

| 位置 | 内容 |
| --- | --- |
| `integration/postgres.ts` | 数据库、路由与诊断链路联调 |
| `integration/provider.ts` | ModelRuntime 适配、结构化输出与预算处理 |
| `review_candidate.py` | 候选的规则分析与证据审核 |
| `quality.py`、`test_quality.py` | 指标计算与测试 |
| `dataset/` | 40 例数据、标注协议与复核记录 |
| `results/postgres-e2e.json` | 11 个数据库场景结果 |
| `results/quality.json`、`results/per-case.csv` | 逐例观察、审核与指标 |

## 实验报告

1. [PostgreSQL 端到端联调](POSTGRES_E2E_REPORT.md)
2. [Provider 与预算设计](PROVIDER_AND_BUDGET.md)
3. [数据集协议](DATASET_PROTOCOL.md)
4. [规则与审核对照](BASELINE_SHADOW_COMPARISON.md)
5. [审核误差分析](REVIEW_ERROR_ANALYSIS.md)
6. [回归总账](REGRESSION_REPORT.md)

平台源码位于 [`../../platform/`](../../platform/)。实验的原路径与冻结清单可通过[归档标签](../../docs/REPOSITORY_LAYOUT.md)检出。
