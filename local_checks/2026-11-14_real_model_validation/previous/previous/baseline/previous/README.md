# VNext 语义归因 Shadow 交付

先读 [实验结果](EXPERIMENT_RESULTS.md) 和 [推广决策](PROMOTION_DECISION.md)：新增原型能发现三类结构化语义偏差，已经做了 6 次真实 DeepSeek 调用，但没有通过严格独立泛化验收，**不接入平台默认行为**。

本包是本轮完整的独立候选代码、便携规则快照、数据、报告与证据，**不是整个平台源码或依赖包**。解压后只需 Python 标准库即可做离线审核/复现；平台原 TS 回归需要原仓库及既有 node_modules。

## 阅读入口

1. [实现审计](IMPLEMENTATION_AUDIT.md)：实际副本、历史脚本、旧合同及兼容边界。
2. [设计与决策](SEMANTIC_ATTRIBUTION_DESIGN.md)：候选、三层审核、成本和隐私限制。
3. [实验结果](EXPERIMENT_RESULTS.md)：真实模型与人工回放分开报告。
4. [消融结果](ABLATION_RESULTS.md)：各审核层贡献与风险—覆盖。
5. [推广决策](PROMOTION_DECISION.md)：未满足的质量条件与关闭方法。
6. [学习与面试总结](INTERVIEW_TECHNICAL_SUMMARY.md)：讲法、技术难点、源码顺序。
7. [指标变更记录](EVALUATOR_CHANGELOG.md)：保留错误初版、修订定义，不修改 Gold。

## 离线复现（不花钱）

使用 Python 3.10+。本机验证使用 Codex 缓存 Python。以下命令在解压目录执行，PowerShell 中把 python 换成自己的解释器即可：

```powershell
python -B -m unittest test_shadow.Tests.test_three_types
Get-Content .\data\dev.jsonl -TotalCount 1 | python -B -m shadow.cli
python -B run_experiment.py replay dev
python -B run_experiment.py replay holdout
python -B summarize.py
python -B test_shadow.py
```

replay 是固定人工候选，绝不会调用供应商；summarize 只重算保存结果，并验证最终审核器能重现原保存判决，不会重跑真实模型。test_shadow 会开 127.0.0.1 HTTP Mock；若本机策略拦截监听/连接，应调整本机测试权限并保留失败日志，不跳过后声称通过。

独立审核接收 stdin 或 `python -m shadow.cli --input envelope.json`。envelope 形状为 `{trajectory,candidate}`；本包数据行也可直接输入（识别 fixtureCandidate）。输出 JSON 支持列表或 needs_review；1MiB 上限，不访问网络/数据库。协议详情见 schema 和设计报告。

重放会更新对应 replay 结果；建议在解压副本中执行，交付 ZIP 保留原始结果。不要运行 data/build.py 覆盖数据；该脚本发现已存在的数据会退出。

## 已保存真实结果，不自动继续付费

`results/real-holdout.json` 是 6 次真实模型输出；`real_attempts.json` 记录 6/6 预算已用完。`python run_experiment.py real holdout` 在本包中会拒绝重复调用。后续若需要新实验，应另行确定新数据与明确预算，保留当前记录，不能删除账本凑结果。

模型函数 generate 提供 model 参数；密钥可从 DEEPSEEK_API_KEY 或隐藏输入读取。不要把密钥写入参数文件/日志。本交付不需要密钥即可看结果、重算指标和做 Mock 测试。当前外发只允许合成数据，真实用户 Trace 被拒绝。

## 原平台回归（需要原仓库）

本机原目录为 `C:\Users\1\Desktop\就业agent\agent-eval-project\local_checks\2026-11-10_semantic_vnext`，相邻实际平台为 `2026-11-08_platform_audit/platform`。

```powershell
python -B run_checks.py
```

脚本使用最小测试环境，依次运行新测试、原 Python 和原 TS 归因子树，把命令/退出码/日志写入 results。该 TS 组不是生产数据库/UI 测试。便携包没有整个平台时，不运行这个命令；离线 replay 会自动使用 baseline 中逐字复制的纯规则文件。

## 结果与验证文件

- `results/summary.json`：最终指标、消融、Token/延迟和费用估算。
- `results/per-case.csv`：126 行方法级逐案例结果；不可把真实六例与其离线回放当独立案例累加。
- `results/rejections.json`：每条拒绝原因。
- `results/regression_commands.json`、`shadow.log`、`old-python.log`、`old-bridge.json`：真实回归收据。
- `SOURCE_FREEZE.json`、`default_unchanged.json`：原关键文件比对。
- `ALGORITHM_FREEZE.json`：未能预先冻结的局限；不是严格盲测证明。
- `FINAL_MANIFEST.json`：交付文件 SHA；它是最终状态记录，不能冒充实验前冻结。

关闭本原型只需不运行实验入口，无 DB 迁移、无默认配置开关、无生产文件需要恢复。
