# 真实模型开发实验

通过平台 ModelRuntime 执行 6 次真实模型请求，覆盖 4 个不同 Trace，对比 v1、v2、v3 三个 Prompt 版本的结构化输出、规则对照和证据审核结果。

## 实现与验证

- 复用 ModelRuntime 接入供应商，采用版本化 Prompt 和结构化候选合同。
- 校验 scope、inputDigest、decision 枚举和比较值类型。
- 逐次保存原始脱敏响应、Token 用量、请求延迟与审核结果。
- v3 的 3 次输出通过结构校验，覆盖答案矛盾、正常轨迹和状态更新后的恢复轨迹。
- 完成 6 项离线结果测试，检查身份字段、数值类型、枚举、证据支持、轨迹状态与调用记录。

## 离线检查

```bash
cd experiments/model-smoke
python -B test_results.py
```

也可在仓库根运行 `python -B scripts/check.py`，统一检查诊断模块、指标计算与模型结果。

## 文件导航

| 位置 | 内容 |
| --- | --- |
| `integration/provider.ts`、`provider-v3.ts` | v2 / v3 Provider 与 Prompt 实现 |
| `frozen/` | 规则和审核器快照 |
| `archive_inputs/` | v1 输入、结果与共享调用账本 |
| `results/real-smoke-v2.json`、`real-smoke-v3.json` | 供应商响应、Token 与延迟 |
| `results/analysis.json` | 六次请求的模型输出、规则对照与审核分析 |
| `results/per-call.csv` | 逐次调用汇总 |
| `analyze.py` | 逐次分析与指标汇总逻辑 |
| `FREEZE.json`、`FREEZE_V3.json` | 各版本实验前的配置和源码记录 |

实验结果见 [RESULTS.md](RESULTS.md)，Prompt 迭代过程见 [REVISION_PLAN.md](REVISION_PLAN.md) 和 [REVISION_V3.md](REVISION_V3.md)。
