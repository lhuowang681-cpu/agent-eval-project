# 课程源码事实核对

审计日期：2026-11-08。只读研究；没有改业务、学习包、历史结果，没有调用模型或重新跑测试。源码路径相对 `agent-eval-project/`。JSON伴随文件保留12个锚点、调用链、局限及证据文件SHA256。

## 应采用的项目定位

这是“平台评测执行与评分 + 可追溯故障观察及保守审核原型 + 历史分析/报表材料”的组合。平台工程闭环能运行，不代表自动根因定位质量已合格。legacy有两条独立主链，当前桥接没有把所有旧脚本自动串成一条产品流水线。

## 两条legacy主链与门禁

模型线：`badcase_analysis.run_pipeline:33 → 抓取/缓存 → 可选XLSX去噪 → llm_classifier.classify_batch → 聚合/图表 → 可选高频案例报表`。`offline`只跳过抓取，仍可能调用模型；`skip_classify`复用分类缓存。模型normalize只校字典、格式和confidence，不验证证据ID/字段原文/因果。

规则线：`structured_jsonl_attribution.main:141 → scan:103 → assistant调用与tool结果配对 → failure_envelope → builtin/external规则 → CSV/JSON`。它是另一个CLI；命名推断来源不等于现平台DB权威来源。不可将原始快照历史异常说成已修复版本。

`reattribution_validator.validate:6`仅部分报表（如top5 single-trace）调用，不是上述两主链必经；它也是启发式重映射。`development_priority`、代表case选择与cause_convergence分别由不同报表调用。

当前固定桥接：`TS runPython → adapter.main → analyze_reviewed → audited_candidate/review_candidate → TS validateDiagnostic`。这里审核必经；纯`analyze`研究入口可单独使用。审核失败时平台仍保留规则观察并标needs_review/unknown及原因码；`review_cli.safeCandidate`才是审核后的白名单输出。不得把phase3的safeCandidate零输出直接说成平台没有诊断记录。

## 12个适合深入的源码锚点

### A01 run_pipeline

位置：`source-reference/attribution/badcase_analysis.py:33`。

调用链：main → run_pipeline → fetch/cache → [optional XLSX denoise] → classify_batch → aggregator → visualizer → optional build_report。

工程重点：将离线分析拆成采集、清洗、分类、聚合、交付阶段；理解缓存与重跑入口。

实际边界：这是原始模型主链；不调用统一证据审核、development_priority或cause_convergence。offline跳过抓取，仍可能调用模型；skip_classify才复用分类缓存。

### A02 normalize_result / classify_single

位置：`source-reference/attribution/llm_classifier.py:94`。

调用链：classify_batch → classify_single:125 → OpenAI-compatible client → normalize_result:94。

工程重点：模型输出契约、taxonomy归一化、重试与失败UNKNOWN降级。

实际边界：module/格式检查与confidence截断不验证证据节点存在、原文字段一致或因果支持；提示词要求不等于执行保证。代码能调用真实模型，不代表质量已验证。

### A03 denoise_trace_nodes

位置：`source-reference/attribution/trace_denoiser.py:65`。

调用链：run_pipeline[提供source_xlsx时] → enrich_traces_from_xlsx:108 → denoise_trace_nodes。

工程重点：按ID去重、父链与错误时间窗口保留，平衡噪声、长度与可观测性。

实际边界：只在特定入口条件使用；父链/邻居等启发式及截断不保证保留完整因果上下文。

### A04 scan / main

位置：`source-reference/attribution/structured_jsonl_attribution.py:103`。

调用链：main:141 → scan:103 → assistant tool_call配对 → failure_envelope:64 → builtin/external rules → CSV/JSON。

工程重点：结构化失败封装、call/result配对、事件去重、来源分流；区分规则与模型依赖。

实际边界：另一独立CLI，不是run_pipeline的下一步；tool_source基于命名启发式，不等于当前平台持久化来源字段。原始快照保留空输入/坏行/跨工具恢复判断等历史边界，不能当作已修复生产副本。

### A05 validate

位置：`source-reference/attribution/reattribution_validator.py:6`。

调用链：generate_top5_single_trace_report → validate_attribution → validate。

工程重点：审核器实际调用位置比名字更重要；下游失败信号与上游责任必须分离。

实际边界：只在部分报表路径调用；不在两条legacy主链必经。它本身是启发式映射，不是当前node/field/quote与support审核器。

### A06 calculate_priority

位置：`source-reference/attribution/development_priority.py:92`。

调用链：generate_new_export_deliverable_v2 → calculate_priority → actionability/evidence/impact/frequency。

工程重点：显式业务排序政策：0.45可修复性+0.30证据+0.15影响+0.10频率；对数频率和硬排除。

实际边界：这是开发优先级，不是归因置信概率。先验/关键词补分仍有证据局限；eligible门槛对actionability依组45/70/80并要求evidence≥30，不是总分阈值。

### A07 select_representative_trace

位置：`source-reference/attribution/representative_case_selector.py:31`。

调用链：多个representative/native/three_stage报表 → select_representative_trace。

工程重点：用主导错误签名、可调试性、证据完整度、频率、距离与稳定tie-break挑可读案例。

实际边界：先按去重trace数选最高频类别，再按多键排序；不是TF-IDF medoid，也不是最严重样本或原因已证实。

### A08 converge / score / medoid

位置：`source-reference/attribution/cause_convergence.py:99`。

调用链：generate_top5_single_trace_report → converge → signature/severity_for → score:88 → winning cluster → medoid:92。

工程重点：将事故严重度与触达频率分开：默认severityWeight×log2(1+独立session数)，再选簇内TF-IDF余弦medoid。

实际边界：实际是确定性规则；文件内LLM提示词未被converge调用。severity和签名是启发式；文本中心样本不等于证据最全或根因正确。与A06/A07不是同一算法。

### A09 build_report

位置：`source-reference/attribution/high_frequency_case_report.py:102`。

调用链：run_pipeline → build_report → category/module rankings + selected cases + multi-sheet XLSX。

工程重点：把事件统计、开发关注范围、代表案例与原始追溯视图分层交付。

实际边界：默认9个sheet与DELIVERY_README的17sheet交付要求/其它模板脚本不同；case_score是confidence×100+min(event_count,20)，不是A06/A08。L8.3/观测缺口从开发榜过滤不等于解决根因。

### A10 AgentEvalAttributionService.enqueue / processJob

位置：`local_checks/2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/index.ts:64`。

调用链：router diagnosisRequest → enqueue → extractTrajectory → digest/engineRevision → async_tasks pending → explicit worker processPending → processJob:171 → conditional lease result write。

工程重点：所有权隔离、K>1 thread选择、稳定内容标识、幂等排队、租约防旧worker覆盖和评分/诊断解耦。

实际边界：当前为显式worker原型，不是已验证的生产分布式调度。DB消息轨迹缺provider/operation等源事件；成功任务不代表root_cause resolved。

### A11 analyze_reviewed / main

位置：`local_checks/2026-11-08_platform_audit/platform/scripts/eval-attribution/adapter.py:152`。

调用链：TS runPython → fixed adapter.py main:175 → analyze_reviewed:152 → pure analyze:88 → audited_candidate → review_candidate → TS validateDiagnostic。

工程重点：跨语言输入输出合同、无shell子进程、大小/超时/错误隔离；引用存在与证据支持双层审核。

实际边界：当前固定子进程入口必经review，但纯analyze可被研究脚本单独调用。拒绝时adapter保留规则观察并标needs_review/unknown及reasonCode；review_cli.safeCandidate才是白名单输出。module/root_cause一律不获支持，模板摘要+全局coverage门禁有已知误拒。

### A12 summarize

位置：`local_checks/2026-11-08_phase3/experiment/metrics.py:62`。

调用链：frozen split/oracle + raw outputs → metrics.summarize → explicit adjudication → comparison-adjudicated → promotion decision。

工程重点：根因正确与故障观察正确分层；UNKNOWN不算正确；引用有效、事实正确、支持性、覆盖和选择性风险分别核算。

实际边界：离线人工候选不是模型成绩；generic类别12条保留不可判。0接受时准确率/选择性风险NA。开发例提升不能代替独立holdout，未推广候选也值得保留教学。

## 排序与代表case不能混讲

| 实现 | 实际算法/目的 |
| --- | --- |
| development_priority | .45 actionability + .30 evidence + .15 impact + .10 frequency；频率对数归一化，有来源/治理硬排除和分组门槛 |
| representative_case_selector | 高频类别→主导错误签名→可调试性/完整度等多键稳定排序 |
| cause_convergence | 规则signature→最大severity×log2(1+独立session数)→胜出簇TF-IDF余弦medoid |
| high_frequency_case_report | confidence×100 + min(event_count,20)选展示案例；不是统一开发优先级 |

这些分数是不同政策/展示选择，既不是统一概率，也不能据此证明根因。

## 报表和三指标的实现边界

默认`high_frequency_case_report.build_report`提供9sheet；17sheet是另一交付规范，其它native/scrollable/template脚本是不同报表版本，不能连成默认必经步骤。模板需要实际源工作簿/模板，代码存在不代表当前平台页面已采用。

三指标归档在源ZIP内`Langfuse三指标评测Skill_最终归档_2026-08-06.zip`，6个脚本/模板/说明文件。manifest定义24h日报、30d指标；设计口径是Trace.latency、有效流式Generation TTFT、Trace下Generation cost聚合及正成本样本，并写有尾部/样本覆盖要求。

实际`build_dashboard.py`只有顶层工作簿读取与HTML写出（8/11/17/33行），指标卡是硬编码历史快照；`validate_dashboard_metrics.py`只检查固定expected字符串（4/5/10/17行）。未发现该归档通用的Langfuse查询和30d指标重算实现。设计口径、静态渲染、动态计算与真实成本验证必须分开。未复制原Trace ID或用户内容。

## 最新实验：工程可跑，质量负结果保留

- phase2：945项选定TS、36项Python是历史工程回归，不是归因质量样本。phase3没有重跑全部945。
- phase3：当前36项Python、71项TS↔Python/轨迹/任务回归通过；候选和恢复后的71不能累计成142。这里只读真实日志收据，没有新执行。
- 数据分开：开发合成12例、历史真实运行但合成任务4条、独立作者合成holdout28例。holdout有24个可观察事故正例、12个预设合成机制；机制未注入平台，不是生产根因gold。
- 所有候选组为固定人工候选离线回放，真实模型调用0；Token、模型延迟和供应商费用为null。

| 独立28例方法 | 输出 | 正确/错误/不可判 | 有效观察/24 | 根因标签命中/12 |
| --- | ---: | --- | ---: | ---: |
| rules | 20 | 8/0/12 | 8/24 | 0/12 |
| direct_offline_candidate | 25 | 14/11/0 | 7/24 | 7/12 |
| structure_only | 25 | 14/11/0 | 7/24 | 7/12 |
| structure_and_valid_refs | 24 | 14/10/0 | 7/24 | 7/12 |
| full_review_baseline_and_candidate | 0 | 0/0/0 | 0/24 | 0/12 |

直接候选7个合成根因标签命中中6个另被作者标为有证据支持，仍是预设候选而非模型成绩。引用组38/38引用有效仍有10个事实错误和11个证据不足命题。规则12条类别粒度保留不可判，输出级风险区间0—60%。完整审核0接受时，准确率/选择性风险为NA，不能写成100%/零风险。

开发集完整审核有效观察1/9→2/9、历史Calculator回放0/1→1/1；独立集仍0/24→0/24，两版本拒绝13条正确且有支持的原候选。另有测试后短摘录兼容退步。候选未推广；四文件已恢复原baseline，本次只读再次核对四个live SHA均与RESTORE_RECEIPT一致。恢复原版也不表示原版质量合格。

真实证据：`local_checks/2026-11-08_phase3/ATTRIBUTION_QUALITY_REPORT.md`、`QUALITY_RESULTS.json`、`PROMOTION_DECISION.md`、`RESTORE_RECEIPT.json`、`regression/python-current*`和`regression/bridge-tasks*`。三组数据不相加宣传；已有数据未证明可信自然场景根因gold。

## 最容易误讲的5点

M01 **容易误讲：**把legacy全部脚本讲成一个已集成的平台流程，offline等于不调用模型。

应讲清：模型run_pipeline和结构化JSONL规则CLI独立；去噪/模板/报表有条件，offline仍可分类调用模型。当前TS-Python桥接是后续独立集成。

M02 **容易误讲：**每条历史链都必经证据门禁，有nodeId或合法引文就证明内部根因。

应讲清：legacy normalize只归一化，validator仅部分报表调用；当前固定adapter必经审核但拒绝仍保留标记观察，safeCandidate与原记录不同。存在性≠支持性≠因果责任。

M03 **容易误讲：**开发优先分、严重度频率分和代表case选择是同一个置信度算法。

应讲清：四维政策分、严重度×对数触达、可调试性排序、TF-IDF medoid、默认报表confidence/event_count五种目的和调用路径分开。

M04 **容易误讲：**945/36说明最新归因高准确；Mock或人工候选是模型质量，优化已上线。

应讲清：945/36是phase2工程基线；phase3当前36/71，真实模型0调用，独立合成集完整审核0输出，候选未推广并恢复原版。工程通过与质量未通过同时成立。

M05 **容易误讲：**多sheet规范和三指标Skill意味着当前平台已有动态30d看板、完整Benchmark与可信真实根因数据。

应讲清：默认9sheet、17sheet交付要求、各模板/快照脚本分开；三指标归档实际是工作簿+历史HTML渲染，未证通用动态计算。历史数据缺独立根因标签/脱敏验收，不纳入gold。

## 本次核对方式和边界

使用只读文本、Python AST获取函数行号/调用关系，读取保存的phase2/phase3报告、命令收据和回归JSON，并计算源文件哈希；没有import会加载dotenv或产生输出的legacy脚本，没有读取.env，没有提取/复制原始用户轨迹。三指标仅检查归档中的脚本/说明。所有实验数是已有记录，不是本次新测。

这份资料只提供可验证事实与课程深挖位置，不构成课程章节、上课内容或继续开发授权。
