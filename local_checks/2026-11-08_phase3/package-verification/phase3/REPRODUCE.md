# 第三轮复现与回滚说明

默认平台已恢复第二阶段审核；optimized是**未推广候选**，已知存在兼容退步。所有正式输入/标签/版本都冻结，复跑请使用新结果名，勿覆盖正式holdout或重新生成其builder数据。

## 只跑离线研究：Python标准库即可

在项目目录 `C:\Users\1\Desktop\就业agent\agent-eval-project`：

```powershell
python ./local_checks/2026-11-08_phase3/experiment/run.py ./local_checks/2026-11-08_phase3/data/development.jsonl replay-development
python ./local_checks/2026-11-08_phase3/experiment/run.py ./local_checks/2026-11-08_phase3/data/controlled-replay.jsonl replay-controlled
python ./local_checks/2026-11-08_phase3/experiment/run.py ./local_checks/2026-11-08_phase3/holdout/private/cases.jsonl replay-holdout --unreviewed-rule-support
```

每条命令分别载入baseline/optimized冻结版本并校验SHA，只把不含标签的id/trajectory/candidate送进独立子进程；五组相同候选回放，输出到results/replay-*。没有联网、ModelRuntime调用、供应商密钥、显卡或新依赖。环境默认编码若不是UTF-8，脚本已明确指定文件/子进程编码。

本机正式命令使用：
`C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`，Python3.13。换电脑可用本机Python3.10+；这些离线脚本只用标准库。交付ZIP解压后的phase3目录也可直接：

```powershell
cd 解压目录/phase3
python experiment/run.py data/development.jsonl replay-development
python experiment/run.py holdout/private/cases.jsonl replay-holdout --unreviewed-rule-support
```

它是归因研究材料，不是完整平台安装包。Node集成回归、原ZIP数据来源审计和96参考核验仍依赖现有项目/依赖，不承诺单独ZIP可跑全平台。

## 标签及最终指标

holdout公开输入inputs.jsonl无labels，oracle在private/cases.jsonl。private表示评估隔离，不是生产隐私数据；全是手工合成。不要运行private/build_holdout.py或freeze_holdout.py来覆盖冻结文件。

```powershell
Push-Location ./local_checks/2026-11-08_phase3/holdout
python -B validate_holdout.py
python -B -m unittest -v test_validation.py
Pop-Location
python ./local_checks/2026-11-08_phase3/experiment/adjudicated_metrics.py
python ./local_checks/2026-11-08_phase3/generate_reports.py
```

最后两条只读取已保存正式outputs、冻结oracle和adjudication/DECISIONS.json重算，不再次执行算法。首次comparison.json保留初始过程统计；最终使用comparison-adjudicated.json。rule标签冻结时只有轨迹观察资格，故首次正式回放显式把输出支持置null；最终由去方法/去审核信息的30条实际输出另外裁决，绝不回填或修改原标签。

adjudication包含内部代理审阅、12条类别粒度歧义null，不是独立人工gold。离线holdout只能复现固定候选/合同/政策，不能复现不存在的真实模型效果。

## 回归、旧审计与兼容探针

```powershell
python ./local_checks/2026-11-08_phase3/regression/run.py
python ./local_checks/2026-11-08_phase3/audit/reproduce_rejections.py
python ./local_checks/2026-11-08_phase3/audit/reproduce_metrics_contract.py
python ./local_checks/2026-11-08_phase3/experiment/posthoc_compatibility.py
```

第一条需要完整platform及已有Node依赖：原版36、候选开发政策8、指标合同8、当前默认36和71项TS归因回归；原版对新政策探针的exit1是**预期红证据**，不是把失败包装成算法通过。原版探针2通过6失败；候选8通过。候选36项完整Python另在python-candidate-working-tree.log保存；候选71项在bridge-candidate.*，恢复后71项在bridge-tasks.*，不要累计为142项不同测试。

原Python来源AST测试依赖原目录层级，runner会用冻结文件构造很小的baseline-layout并复制已校验的单一规则来源，保持原测试不改。第一次直接搬目录导致的来源路径失败保留baseline-relocation-failure.*；不是业务失败，不能忽略后假称原样通过。

旧拒绝审计依赖phase2/increment3/experiment/results.json和increment2/http/results.json；它固定加载baseline审核，不随默认/候选变化。旧统计缺陷脚本加载audit/source-snapshot/metrics-before.py，仅重现已修的早期统计问题，不代表当前metrics仍有那些缺陷。兼容探针是测试后的诊断，不能并入正式28例或拿它调参后继续称盲测。

## 默认代码、候选应用和回滚

```powershell
python ./local_checks/2026-11-08_phase3/verify_changes.py
```

该命令核验当前platform九个相关文件与baseline完全一致、候选SHA未变、96原参考未变，并在隔离fixture应用及反向回滚四文件候选补丁。不会应用到当前平台。SOURCE_CHANGES.json与RESTORE_RECEIPT.json保存真实结果。

`platform-phase3.patch`只用于查看或隔离复现实验；当前默认未应用，**不建议推广**。若要在新的第二阶段源码副本检查：在副本根目录使用 `git apply --check --ignore-space-change 补丁绝对路径`，再 `git apply --ignore-space-change 补丁绝对路径`；回滚先 `git apply -R --check --ignore-space-change 补丁绝对路径`，再 `git apply -R --ignore-space-change 补丁绝对路径`。

restore_baseline.py是本次有前置SHA保护的恢复事务，记录已经保存；不要当成通用重置工具反复运行。没有删除数据、启动服务、修改原评分/模型配置或新增技术栈。本轮未重跑真实PG/UI、全库945项或全库类型；结果不要与上轮历史验收混称。
