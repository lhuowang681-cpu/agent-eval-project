# 面向工程学习的难点和源码索引

建议按“事实进入系统→候选→审核→统计→推广决策”读，先能说清每一层允许证明什么，再谈模型或准确率。

| 顺序 | 核心问题 | 精确源码入口 |
| --- | --- | --- |
| 1 | 任务失败和运行时失败为何不同？ | [adapter.analyze](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/baseline/adapter.py:88)：只把真实error/失败封装转观察；evaluation.score失败不自动生成根因 |
| 2 | 如何保证证据属于原Case/Thread？ | [extractTrajectory](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/trace.ts:41)：所有权、调用ID、sourcePointer和覆盖警告；[validateDiagnostic](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/contracts.ts:275)：身份与引文核验 |
| 3 | 引用真实为什么不能证明归因？ | [原版review_candidate](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/baseline/evidence_review.py:33)：存在性、责任声明、分类匹配、摘要和coverage五种不同约束；audit/REJECTION_AUDIT列全部19个issue |
| 4 | 字段隔离为何既修bug又引入误拒？ | [候选cited_category](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/optimized/evidence_review.py:33)与[匹配点](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/optimized/evidence_review.py:141)：防跨字段借证据，却丢同字段封装语境；posthoc_compatibility.py是反例 |
| 5 | 故障定位怎样与评分生命周期解耦？ | [独立任务enqueue](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/index.ts:64)、[processJob](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/index.ts:171)：输入快照、版本、lease及迟到结果隔离，分析错误不改原分数 |
| 6 | 消融如何保证只改变审核？ | [五组evaluate](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/experiment/engine_worker.py:48)：相同候选；[main](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/experiment/engine_worker.py:59)：标签盲输入和不变性校验 |
| 7 | UNKNOWN怎样既不加分也不混成错误？ | [correctness](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/experiment/metrics.py:32)、[summarize](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/experiment/metrics.py:62)：根因/观察、可判/未知、风险界与执行异常；test_metrics.py提供反例 |
| 8 | 为什么没有提升就不该推广？ | OPTIMIZATION_DECISION.md是测试前决策；PROMOTION_DECISION.md是测试后验收；optimized/MANIFEST和holdout/split-manifest证明顺序，默认代码恢复回执可追溯 |

## 应能讲清的工程判断

外部500能证明一次失败曝光，不能直接证明内部参数生成错误。完整调用图也不是根因充分条件；还需要参数/配置变换、错误最早产生位置、服务端契约及可反证的因果链。当前平台更适合提供故障观察与复核证据。

全局coverage和某个claim的证据充分度应分开。没有完整provider事件，并不抹掉原始CalculatorError；反过来，某个error存在也不允许引用同节点成功content当成证明。最小可信上下文应以字段/封装/调用身份界定，不能简单地越少越安全。

审核复用原分类函数有工程收益，也会继承其盲点。若规则只能给generic fallback，审核就可能拒绝更具体且有证据的候选。规则一致率、模板一致率都不是独立质量真值；必须先定义类别粒度与标签可信度。

完整审核输出可以是新生成的有限观察，它不等于原LLM整段因果文本已被证明。对比时必须保存原候选，分别评价事实真伪、引用存在、证据支持和结论强度。

本轮最重要的负结果：开发1/9→2/9没有在独立28例带来完整审核收益，而且发现兼容退步，因此保留原版默认。这体现实验验收和可回滚决策，而不是用测试通过数代替算法质量。

## 适合面试中的准确表述

“我做了一个基于既有Agent评测平台的轨迹诊断研究：按Run/Case/Thread保留证据身份，Python分析与评分解耦；又把审核分为结构、引用和支持性，用固定候选消融并记录弃权风险。实验发现引用有效不等于归因正确，过强审核会损失覆盖；局部优化未通过独立合成验收，所以没有默认推广。真实模型与真实根因gold仍是待验证项。”

不能表述成“真实模型归因准确率已达某值”“Benchmark证明优于规则”或“全轨迹根因已定位”。本轮没有这些证据。
