# System VNext · 诊断与证据审核

基于 Agent Trajectory 的 Python 分析模块，实现规则诊断、局部证据审核、语义候选处理和故障模式归并，并通过 TypeScript runner 与平台连接。

## 模块组成

| 文件 | 职责 |
| --- | --- |
| `vnext/pipeline.py` | 编排规则分析、证据审核、语义候选与观察去重 |
| `vnext/review.py` | 核验节点、原文引用、任务范围和局部结论支持 |
| `vnext/provider.py` | Provider 调用、调用次数与 Token 预算、超时处理 |
| `vnext/grouping.py` | 事件去重、模式归并、代表 Trace 与严重度分布 |
| `sidecar.py` | JSON 输入输出入口 |
| `integration/runner.ts` | 平台 runner 扩展与分析结果记录 |
| `baseline/` | 分析流程使用的冻结依赖与对照实现 |

## 运行

从仓库根运行：

```bash
python -B scripts/check.py
python -B scripts/demo.py
```

单独运行本模块的 14 项测试：

```bash
cd diagnostics
python -B -m unittest test_review test_system
```

## 输入与输出

`sidecar.py` 接收 Trajectory，或包含 `trajectory`、`config`、`mockCandidate` 的 JSON 对象。输出包含 `scope`、`inputDigest`、规则分析、证据审核、语义候选处理结果和结构化观察。

语义处理通过 `enabled` 配置启用，配置项包含模型、来源、调用次数、Token 与超时。命令行演示使用 `MockProvider` 和合成轨迹。

## 实验与设计文档

- [架构](ARCHITECTURE_VNEXT.md)
- [证据审核实验](EVIDENCE_REVIEW_QUALITY.md)
- [模式归并与优先级](GROUPING_AND_PRIORITY_REPORT.md)
- [语义归因实验](SEMANTIC_ATTRIBUTION_REPORT.md)
- [测试总账](TEST_AND_REGRESSION_REPORT.md)
- [仓库目录与历史归档](../docs/REPOSITORY_LAYOUT.md)
