# System VNext 真实集成验收（2026-11-14）

本轮已完成真实PostgreSQL诊断链、现有ModelRuntime适配、本机模型Mock联调及新40例离线评估。**没有新增真实付费模型调用；严格独立人工质量集与真实LLM增量仍未验收，不推广。**

## 阅读顺序

1. [真实数据库报告](POSTGRES_E2E_REPORT.md)：11场景、真实tRPC/Worker/消息/落库，正常通过轨迹按原策略跳过。
2. [Provider与预算](PROVIDER_AND_BUDGET.md)：统一ModelRuntime、调用/Token/超时约束、授权请求0。
3. [新数据集](DATASET_PROTOCOL.md)：40合成案例、原Gold与正式运行前复核、单作者限制。
4. [对照](BASELINE_SHADOW_COMPARISON.md)：增强规则Mock的结果不是LLM成绩。
5. [审核误差与修复](REVIEW_ERROR_ANALYSIS.md)。
6. [测试总账](REGRESSION_REPORT.md)。
7. [不推广决定](PROMOTION_DECISION.md)。

## 文件与版本

实际平台仍是相邻`2026-11-08_platform_audit/platform`；本目录不修改其业务源码。`previous/`为上一轮完整冻结快照，包含旧回归、Prompt、基线与负结果。BASELINE.json记录源码与旧交付Hash，PROTOCOL_FREEZE记录新数据、复核层、指标与适配器冻结。新结果全部只写results/。

结果入口：postgres-e2e.json为最终11场景；provider-test.json为10项最终SDK/HTTP Mock检查；quality.json包含每条Trace、应用复核后的Gold、候选、审核与汇总；per-case.csv为40×3=120行离线方法结果；review-probes为5个后验诊断与12条历史判决重现。早期attempt日志/error.json均保留，不与最终状态混用。

## 无收费离线复现

Python3.10+标准库即可运行指标/审核，不需要GPU或Key。普通模式运行，不把继承assert检查的原型当作-O模式生产安全边界：

```powershell
python -B test_quality.py
python -B verify_delivery.py
python -B review_probes.py
```

要复现40例，请在交付副本内移开**复制出来的**results/quality.json，再运行`python -B quality.py`；脚本拒绝覆盖正式结果、先核对Hash。不要重跑build.py覆盖原样本，不要为了得分修改ADJUDICATION。verify_delivery检查最终manifest；在实验副本产生新结果后，该副本不再等同原交付字节，这是正常的。

review_candidate.py接收stdin `{trajectory,semanticCandidate?,providerMetadata?}`，只执行Python规则与证据审核，不调用模型。原Trace合同不变，返回新sidecar，不能直接当旧Diagnostic落库。

## 真实数据库复现（需完整项目依赖）

本包是增量，不含PostgreSQL二进制和node_modules。使用原完整目录结构，PowerShell先在本目录：

```powershell
.\start_pg.ps1
$env:DATABASE_URL='postgresql://postgres@127.0.0.1:15435/vnext_acceptance_20261114'
node migrate.cjs
```

迁移器只允许上述专用数据库。切到实际平台目录，设置DATABASE_DRIVER=node、NODE_ENV=development、EVAL_ATTRIBUTION_PYTHON为本机解释器，以及仅用于测试的KEY_VAULTS_SECRET（本轮使用32字节零值的base64：`AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`）。

```powershell
node --import tsx --require ../../2026-11-14_real_acceptance/integration/validator-compat.cjs ../../2026-11-14_real_acceptance/integration/postgres.ts '本轮目录绝对路径'
```

测试每次使用新合成用户，不删除旧数据。真实应用路由、DB、extractTrajectory、任务/Worker均执行；Node兼容层仅加载已安装真实实现/Markdown原文，未模拟业务，但不代表生产依赖无问题。验证的是server-side tRPC caller，不是浏览器登录HTTP链。结束后停止本轮专用集群：

```powershell
& "$env:TEMP/vnext-acceptance-pg-bin/bin/pg_ctl.exe" -D "$env:TEMP/vnext-acceptance-pg-data" -w stop
```

当前已经停止，临时数据保留。原始模型运行没有重跑，数据库消息是可重复的合成持久化fixture。

## Provider适配与启用边界

integration/provider.ts复用ModelRuntime，仅输出结构化候选；review_candidate.py负责独立审核。integration/runner.ts复用旧隔离包装器，可注入现有ServiceOptions.runner，record应写独立制品类型，不改原评分/诊断Schema。没有默认路由开关自动启用它。

provider_cli.ts读取JSON配置及明确命名的Key环境变量；默认关闭、approvedRequests=0。没有模型与费率授权时不能设paid额度。BUDGET.json为本轮授权记录：0请求、0实际付费，金额估算NA。不要删除账本重复消费。

在平台cwd运行provider.test.ts时传本轮绝对目录和Python解释器；测试仅localhost HTTP Mock，所有usage是合成值。运行checks.py需原平台依赖，涵盖评分/归因子树，不代表945全量或全库类型检查。

关闭/回滚：不注入runner或enabled=false；无数据库Schema迁移、无原业务代码需要恢复。验收只用了既有async_tasks独立类型，线上sidecar查询UI/API尚未新增。默认保持原链路。
