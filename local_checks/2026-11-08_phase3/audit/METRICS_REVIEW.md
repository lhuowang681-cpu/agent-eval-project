# 第三轮统计合同只读复核

复核仅覆盖engine_worker.py/metrics.py及自建纯统计反例，未读取holdout、未运行模型、未改实验脚本或算法。原版快照保存在本audit/source-snapshot：metrics-before.py SHA256为`4fa93851ed7b1ed8bd5b462547fa535e31bb484a1ec514af6945a90710167135`。以下行号指该快照，后续统计修复需另行验收，不能用本报告声称已修好。

状态说明：主流程随后已报告完成显式nullable支持标签、judged/unknown覆盖与风险区间、ID一一对应、nodeId类型防护等统计修复，并有8项metrics测试通过。本报告保留最初缺陷和可重现反例，不声称当前脚本仍有这些已修问题；本任务尚未独立重跑其修复后版本。算法源码未由本任务修改。

主要结论：UNKNOWN目前不会计成正确，这点符合要求。但支持性默认标签、risk/coverage人口不一致、缺少records完整性检查会夸大或扭曲结论。尤其不能把full重新生成的有限观察正确，当成原LLM根因候选变正确。

## 已确认符合口径的部分

- metrics第31—44行：无claim返回correct=None；no-claim UNKNOWN的correctClaims为0、acceptedAccuracy为null，而非1。
- 事实未知和证据不支持是两个维度。自建“真实根因未知”的原候选返回correct=None、supported=False；不会把缺因果证据自动计为错误根因事实，也不会把unknown直接算正确。
- knownRootCorrect要求原标签root.known、模块/类别匹配且correct=True。rootClassificationAccuracyAllKnown分母为全部已知根因case，弃权不加分；selectiveKnownRootAccuracy仅看已知真值且实际输出root的子集。不能只展示后者而隐藏根因覆盖率。
- valid_references只核对节点、字段、引文存在；该结果和supported分别输出。字段引用有效本来就不证明责任，需独立支持标签继续区分。
- token/cost/model latency保留None；worker明确modelCalls=0、固定离线候选，未把本地规则耗时冒充模型推理耗时或供应商费用。

## 实际统计缺陷与歧义

### 1. 支持标签的fallback将资格、原候选、规范新命题混在一起

metrics第56行full缺safeCanonicalSupported时继承candidateSupported；第57行rules缺ruleCanonicalSupported时继承observationEligible。

纯函数反例：轨迹error字段有500，但rules输出只引用content中的“lookup succeeded”。quote确实存在、case确实有可观察失败，于是references valid且support=True。observationEligible仅说明case中存在可观察事故，不证明当前输出的字段/quote支持它。反方向，原候选有额外错误责任断言所以candidateSupported=False，full的新有限观察可能正确引用原error；缺新标签时仍继承False，误把原候选判决搬到新输出。

应强制显式支持标签，且标签针对各方法实际输出、对应类别/引用/有限命题，而不是只针对轨迹整体。即使字段强制存在，若ruleCanonicalSupported仍简单填observationEligible，统计漏洞仍在。后续输出级复核要另存裁决，不修改既有原始label，不按最终效果回调算法。内部代理审阅也不是独立人工gold。

### 2. risk-coverage横轴和风险使用不同可判定人口

metrics第88、94行：coverage=所有claim/n，knownErrorRisk=wrong/有可判定真值的claim。自建10例中9个根因真值None、1个已知正确观察，可得到coverage=1、acceptedAccuracy=1、knownErrorRisk=0，但只有1个claim得到事实判定。

公式自身名为“known”并非算术错误，且原输出列有unjudgedClaims/supportRisk；但如果只画二维点或概述“全覆盖且零风险”，就会隐去90%未判定。应同时给judgedCoverage=judged/n、unjudged/claims，并给所有claim上的事实错误风险界：下界wrong/claims，上界(wrong+unjudged)/claims。该反例是[0,0.9]，不是已证明0。支持风险与事实错误风险不能相互替代。

### 3. cases与结果未校验一一对应

metrics第61、68行按id建字典再遍历records，但没有检查唯一ID/全覆盖。同一case给两条record时，claimCoverage=2、abstentions=-1；缺record时被计为abstention=1、executionErrors=0，而非未执行。必须先拒绝重复、未知、遗漏ID及方法集合不完整，不能把缺结果包装成主动弃权。worker遍历输入也不自行验证id唯一性，不能只依赖正常运行时恰好满足。

### 4. direct原始坏schema可能使统计崩溃

metrics第23行的nodes.get(ref.get('nodeId'))没有先检查nodeId是否字符串；原始direct候选nodeId=[]触发TypeError。structure/citations可以拦截，但direct臂按设计保留不可信原候选，统计仍需安全地将其计为无效引用，不能崩溃或默默丢掉此case。METRICS_PROBES.json有真实异常类型记录。本任务只报告，由主流程修统计。

### 5. 执行失败不等于门槛误拒，root弃权率也有定义差异

第75行falseRefusal未排除executionError。自建full发生RuntimeError、output=None时，executionErrors=1、abstentions=0，但falseRefusals仍列出该case。应将分析器故障和审核拒绝分开，不能把可用性故障解释成证据门槛错拒。

同例rootAbstentionRate=1，而普通abstentionRate=0，因为前者用(n-rootClaims)/n也包含故障。可以保留“没有输出root”的率，但需更名或说明；若称主动根因弃权，应排除执行失败。暂无据此推断真实实验已经出现执行故障。

## 原候选与规范新输出必须分别解释

worker冻结快照第52行direct保留原候选，第54行structured/citations仅决定保留或拒绝，不改其文本；full第55—56行使用safeCandidate，可能是新的规范有限事故观察。metrics第36—44行也分别用candidateCorrect和观察标签判定，方向合理。

因此full正确观察可能来自一个原始事实/责任不正确的候选；这只能说“新输出的有限命题被支持”，不能说“LLM原根因更准确”。acceptedAccuracy混合了不同claimLevel及不同输出强度，不能单列一张总准确率图证明归因增强。应同时展示原候选判定、规范观察有效覆盖、root已知真值分类正确数/覆盖，且保持原摘要未验证部分明确可见。

effectiveObservationCoverage当前是“至少产生一个有效有限观察的case数/可观察case数”，不是所有故障事实的召回率。同case有多类故障时，命中其中一类不代表完整诊断。falseRefusals也应明确只评价原正确且有支持候选的保留/拒绝，不与另一个规范命题正确性混称。

## worker隔离与统计边界

worker冻结快照第62、65行只允许request.cases及每行id/trajectory/candidate，显式拒绝labels/root truth进入worker；第78行检查输入不变。观察到的是工作进程层面的标签盲，不等于合成样例作者、候选作者、最终审阅者相互独立。不能用此宣称独立人工gold或真实模型泛化性能。baseline/optimized导入各自engine目录是合理的版本隔离，版本文件/hash与运行分配仍需主流程另行核验。worker快照SHA256为`1f145e9dd86c2c9bc66b4be93014c7cd89434eb795732263b791d6375e8cba92`。

本报告不检查holdout内容，不针对其样例做规则调整；后续任何输出级支持复核只能作为独立审阅附件，保留原label和预先冻结算法。不得为了让规则臂看起来有支持，把其实际引用和类别省略成全轨迹eligibility。

## 可复现材料

运行audit/reproduce_metrics_contract.py会只导入固定metrics-before.py快照、生成METRICS_PROBES.json。材料均为内部自建统计合同反例，不是新模型评测集。已实测UNKNOWN正确计数0、错引默认support=True、risk未知人口、覆盖率2、缺结果算弃权、坏nodeId导致TypeError、执行故障混入falseRefusal。未读取holdout或修改算法。
