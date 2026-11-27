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

该标签保留整理前的全部文件，包括早期实验、两份完整平台基线、旧交付包、旧入口说明、学习交接和原路径校验清单。主分支移除了约 20,000 个仅用于这些历史材料的文件，未清除 Git 历史；原本地项目目录也没有改动。

若需严格按当时的路径与冻结哈希重放旧实验，可以另外检出该标签：

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

## 验证边界

- 根目录离线检查覆盖 14 项 sidecar 测试、4 项指标测试和 6 项已有真实模型结果的离线断言；最后一组只读取历史结果，不调用模型。
- 演示仍使用原合成输入和 Mock 候选，结果写到标准输出，不覆盖冻结结果文件。
- 整理只改目录、导航及连接到平台的相对路径，没有修改平台业务逻辑、Gold、原始模型响应或评分算法。
- 实验内的 `FREEZE`、`FINAL_MANIFEST` 和旧验证器是历史证据，其原路径/源码哈希对应归档标签。主分支的路径适配不改写这些历史记录；严格冻结实验应使用该标签。
- 历史报告、教材中的日期、旧路径和原电脑绝对路径保留为当时记录。当前命令以根 README 和 `scripts/` 为准。
- 本次没有安装平台依赖，也没有重跑 PostgreSQL、Web UI、完整 TypeScript 套件或付费模型。
