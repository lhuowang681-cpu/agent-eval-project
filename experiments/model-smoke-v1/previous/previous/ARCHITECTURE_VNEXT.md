# 当前真实架构（2026-11-14）

默认平台：Dataset/Benchmark/Case → Run → Agent Runtime → 原规则/LLM Judge → Thread/Run聚合 → 显式诊断请求 → extractTrajectory → async_tasks/worker → runPython(adapter.analyze_reviewed) → 原Evidence Review → 原诊断结果。平台实际目录为 ../2026-11-08_platform_audit/platform，核心入口src/server/services/agentEvalAttribution/{index,trace,python,contracts}.ts。未替换此链。

新增受控链：将 integration/runner.ts 的 createShadowRunner 注入原 ServiceOptions.runner：原runPython先执行并保留Diagnostic v1 → enabled明确开启时复制Trajectory → sidecar.py → 原规则Baseline + 独立局部证据审核 + 可选Provider候选/第二轮语义审核 → 版本2 sidecar结果 → 单独record。返回平台的仍是原Diagnostic，不持久化新Schema进旧async_tasks，不写Run/评分/Judge。

Provider以generate(trace,model,max_tokens)注入，配置必须指定model、调用数/Token上限、超时、synthetic来源；默认无Provider，无供应商Key/模型/端点。交付只带MockProvider，不带新收费实现。可由已有ModelRuntime调用者提供Provider；真实ModelRuntime适配与生产隐私审查未实现。Python超时后丢弃迟到结果，不能强杀提供者内部线程，真实供应商取消计费未验证。

独立分析链：外部规范事件JSON → vnext.grouping.analyze → Failure Patterns、分布、三种代表Trace、两类治理建议。没有接入诊断主链数据库或在线任务。

## 模块状态地图

| 模块 | 状态 | 边界 |
| --- | --- | --- |
| platform/src/server/services/agentEval*、scripts/eval-attribution | Active | 原评分/归因链，未修改 |
| 本目录vnext、integration | Experimental | 可执行sidecar与显式runner扩展，默认未注册 |
| 11-12 semantic_vnext_round2 | Experimental/Frozen | 最新完整语义研究与48例，复制到baseline而非覆盖 |
| 11-12 semantic_vnext（无round2） | Unknown | 仅candidate和零散脚本，未验证入口，原地保留 |
| 11-10 Semantic Shadow | Archive/Experimental | 六次真实模型历史输出，非当前默认能力 |
| phase2/phase3历史结果、补丁与回滚 | Archive | 不修改、不删除，28例仅历史回归 |
| source-reference/attribution/{llm_classifier,cause_convergence,development_priority}.py | Legacy | 独立历史工具，不宣称已在线接入 |
| study_pack/key_sources 等重复参考 | Archive | 学习快照，不能据文件名判废弃 |

重复逻辑清单：旧规则分类与旧审核共享failure_envelope/分类函数；11-10/11-12有不同保守语义审核快照；本轮显式审核刻意独立于分类器，语义审核复用已冻结11-12版，不再复制重写；TF-IDF历史实现与本轮标准库实现都为对照保留，不是两个线上聚类服务。

没有Git元数据，不能证明未提交改动或所有其他worktree不存在。GitNexus工具和run.cjs入口不可用；本轮不编辑原平台已有符号，不据静态搜索断言文件可删除。13个活跃Python/TS文件及前轮完整快照哈希留存，依赖边界见runner扩展和原index.ts构造器。没有删除、移动或标记任何原文件为确定无用。
