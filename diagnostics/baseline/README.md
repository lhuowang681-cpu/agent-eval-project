# Semantic VNext 第二轮（2026-11-12）

本轮完成两个审核修复、增强非LLM规则、48例冻结合成对照与相关回归。**仍为独立Shadow，不改平台默认行为。新复杂集真实LLM对照未运行，增量价值未证明。**

## 报告导航

1. [实现审计](IMPLEMENTATION_AUDIT.md)
2. [审核修复](REVIEW_FIX_REPORT.md)
3. [Baseline比较](BASELINE_COMPARISON.md)
4. [数据协议与冻结](DATASET_PROTOCOL.md)
5. [完整实验](EXPERIMENT_RESULTS.md)
6. [消融](ABLATION_RESULTS.md)
7. [错误与误拒](FAILURE_CASE_ANALYSIS.md)
8. [不推广决策](PROMOTION_DECISION.md)
9. [学习与面试](INTERVIEW_TECHNICAL_SUMMARY.md)

先看实验和推广决定。新审核在人工候选上FalseSupport从8到0，FalseGap仍8；不能叫真实模型准确率。增强规则覆盖19/28，人工候选审核覆盖14/28，真实新C/D为未验证。

## 便携离线运行

Python3.10+，仅标准库，无需GPU、模型密钥、数据库或平台node_modules。不要使用Python -O；原型继承旧版assert合同检查，未验收优化模式。解压后在本目录执行：

```powershell
python -B -m unittest test_round2 test_metrics
python -B reproduce.py
python -B legacy_comparison.py
Get-Content .\data\cases.jsonl -TotalCount 1 | python -B review_cli.py
python -B verify_delivery.py
```

reproduce精确重现旧保存判决和两个红绿探针；legacy_comparison仅离线使用旧真实输出。二者输出到本轮results，不覆盖上轮目录。单条CLI接收`{trajectory,candidate}`，也支持数据行scriptedCandidate，输出支持或needs_review，不访问网络。

正式结果已存在，`run_experiment.py`拒绝原地覆盖。要复现正式实验，先复制本交付目录，在副本内**只移开复制出来的results/case-results.json**，然后运行：

```powershell
python -B run_experiment.py
python -B analyze_results.py
```

程序校验算法和协议SHA，使用原JSONL加两层冻结复核视图，重新输出逐案例与汇总；不会生成模型调用。不要删除原交付中的冻结记录，也不要重跑bootstrap/build_cases覆盖它们。

## 原链与兼容测试

`python -B run_checks.py`需要相邻完整平台和既有node_modules，运行新增18、原Shadow15、原Python36、TS桥接71，所有日志仅写本轮。旧15是在旧快照执行，不等于新版全兼容。

`python -B compatibility.py`把未改的旧15项直接换用新审核；实际12通过、2失败、1异常，原因是无闭集支持A的策略收紧。日志保留，不修改旧断言。上述旧测试包括127.0.0.1 HTTP Mock；若本机策略禁止监听/连接，记录环境阻塞，不把跳过写成通过。

本轮没有重跑历史945全平台、真实PG/UI或全库类型检查。

## 结果、预算和回滚

- `results/case-results.json`：全部输入、应用复核后的Gold、人工原始响应、候选、审核、原因与配置。
- `summary.json`、`per-case.csv`：7组方法×48例=336行方法级记录，案例和声明分母分开。
- `analysis.json`：8个被移除不支持接受、8个剩余Gap、按类别结果。
- `legacy-comparison.json`：旧真实六例同输入比较，新调用0，支持观察的LLM-only=0。
- `regression.json`、`legacy-compatibility.json`：通过与不适配均明确记录。
- `SOURCE_SNAPSHOT.json`、算法/协议/数据冻结：前后哈希、执行顺序与限制。
- `previous/`：原版完整Shadow快照、旧输出和Prompt，**不是整个平台**。

上轮6次API预算已用完，本轮没有启用任何新付费调用。复杂语义真实C/D、模型Token/延迟/费用均未验证；不要把offlineSeconds当模型性能。没有真实用户Trace外发，候选目录不含供应商HTTP入口。

关闭仅需不运行本目录。无默认开关、无DB迁移、无业务文件需恢复。增量ZIP包含本轮代码/证据和前版快照，不含全平台依赖或密钥。verify_delivery验证哈希与密钥样式；这不等于全面秘密/PII认证。
