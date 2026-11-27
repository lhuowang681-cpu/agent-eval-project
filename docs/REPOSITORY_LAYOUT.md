# 仓库结构与归档

2026-11-27 整理。主分支从 30,561 个跟踪文件收敛到约 10,400 个；完整平台只保留一份。

## 当前入口

| 目录 | 用途 | 从哪里开始 |
| --- | --- | --- |
| `platform/` | 完整上游平台与已集成的评测/诊断服务 | [诊断服务](../platform/src/server/services/agentEvalAttribution/) |
| `diagnostics/` | System VNext Python sidecar、证据审核与模式归并 | [模块说明](../diagnostics/README.md) |
| `experiments/postgres-acceptance/` | 真实 PG 联调记录、40 例数据与离线对照 | [实验说明](../experiments/postgres-acceptance/README.md) |
| `experiments/model-smoke/` | 最新模型开发 Smoke 的 Prompt、输出与分析 | [实验结果](../experiments/model-smoke/RESULTS.md) |
| `experiments/model-smoke-v1/` | Smoke 的前序输入、冻结副本及共享预算账本 | [实验说明](../experiments/model-smoke-v1/README.md) |
| `source-reference/` | 参考脚本与运行时选段 | [来源清单](../SOURCE_MANIFEST.json) |
| `docs/book/`、`docs/study-pack/` | 历史教材与离线学习材料 | 下载后打开各目录的 `index.html` |
| `scripts/` | 不依赖旧电脑路径的离线入口 | `python -B scripts/check.py`、`python -B scripts/demo.py` |

`platform/` 内的 `packages/`、`apps/desktop/`、`src/` 属于同一个上游 monorepo，保留其原有内部组织与许可证。`diagnostics/baseline/`、实验中的 `previous/` 和 `frozen/` 是当前 Python 导入或实验复现依赖，保留这些小型冻结副本。

## 整理前的完整材料

归档标签：[archive/2026-11-27-before-layout](https://github.com/lhuowang681-cpu/agent-eval-project/tree/archive/2026-11-27-before-layout)，对应提交 `379b403c205530d3274c0ea6b42d835ab7436e14`。

该标签保留整理前的全部文件，包括早期实验、两份完整平台基线、旧交付包、旧入口说明、学习交接和原路径校验清单。主分支集中展示当前平台、诊断模块和最新实验，约 20,000 个历史文件通过归档标签访问。

检出归档标签以使用各阶段的原始目录和冻结哈希：

```bash
git clone --branch archive/2026-11-27-before-layout https://github.com/lhuowang681-cpu/agent-eval-project.git agent-eval-history
```

## 路径变化

| 旧路径 | 主分支新路径 |
| --- | --- |
| `local_checks/2026-11-08_platform_audit/platform/` | `platform/` |
| `local_checks/2026-11-14_system_vnext/` | `diagnostics/` |
| `local_checks/2026-11-14_real_acceptance/` | `experiments/postgres-acceptance/` |
| `local_checks/2026-11-14_real_model_validation_v2/` | `experiments/model-smoke/` |
| `local_checks/2026-11-14_real_model_validation/` | `experiments/model-smoke-v1/` |
| `study_pack/` | `docs/study-pack/` |
| 其他 `local_checks/`、`deliverables/` 和原交付元数据 | 完整保留在归档标签 |

机器可读对应关系见 [repository-layout.json](repository-layout.json)。

## 检查与复现

- `python -B scripts/check.py`：运行 14 项 sidecar 测试、4 项指标测试和 6 项模型结果离线断言。
- `python -B scripts/demo.py`：读取合成轨迹与 Mock 候选，将结构化分析结果输出到终端。
- 实验目录保存数据协议、Prompt、输入快照、逐例输出和执行记录。
- 归档标签保存原目录结构及对应的 `FREEZE`、`FINAL_MANIFEST` 和校验器，可用于按原路径复现各阶段实验。
