# 第三轮：证据审核拒绝与错误接受的只读审计

审计结论：已有真实HTTP的唯一有明确工具失败的诊断，被全局coverage.complete=false挡下；另三条unknown没有提出claim，不能计为拒绝。与此同时，现有审核也可能接受“引用了成功正文、实际却从未引用的error读取失败”的错误证据指向。降低误拒前必须一并补上字段级支持校验，不能仅提高通过率。

本轮只读取原平台源码及phase2存量结果，未改platform/phase2、未接DB、未调用模型或网络。`reproduce_rejections.py`已固定从phase3/baseline导入原版审核/适配/规则，拒绝使用后续正在优化的platform版本；原版TS文件经原始hash核对后复制到audit/source-snapshot。离线重新执行28份审核（12实验×rules/direct＋4 HTTP），与存量review全部一致。来源文件执行前后SHA完全相同。完整候选、逐例审核、源码行及六个克隆输入探针在REJECTION_AUDIT.json。

原版reviewer SHA256=`d9ea1fb10ade950a05118904cade82882fba26227735bb0474eeff67aa986f29`；adapter=`b01d67cbc49778e60e5e0abdf748610514a001930fe15764521fad10d4624d2b`；rules=`c8c2984316aa0e56d283bdeb3afa7f2d0ed53b87f02b0a9d2a4fbc8d2980767e`。脚本启动时强制校验这三个基线hash。以下规则行号全部指这份冻结原版，不描述优化后的实现。

## 统计口径与全部存量实验

| 来源 | 接受事故观察 | 拒绝claim | 无claim，不算拒绝 |
| --- | ---: | ---: | ---: |
| 12例rules | 8 | 1 | 3 |
| 12例direct | 1 | 10 | 1 |
| 最新真实HTTP的4个诊断 | 0 | 1 | 3 |

这里“接受”只指safeCandidate非null；status仍needs_review/moduleId=null，不代表根因确认。job success表示分析器执行成功，也不表示审核supported。实验是控制Mock返回预设候选，labels是合成设计标签，不能外推真实模型准确率。unknown且category/module/refs都为空属于弃权，不是被拒候选，更不是证明业务没有问题。

以下覆盖实验results.json全部12例的rules与direct；`V/S`为存在valid、支持supported；`V/I`为存在valid、支持insufficient；`X/I`为存在invalid、支持insufficient；`N/A`为无claim。完整摘要、refs及原始问题码在JSON逐条保存，未复制庞大的模型exchange提示词。

| 例子 | rules | direct | 原因及归类 |
| --- | --- | --- | --- |
| normal_unknown | N/A | N/A | 无失败证据与具体claim；不是拒绝 |
| external500_wrong_L2_2 | V/S | V/I拒 | direct从外部500推L2.2内部参数责任；root_cause_chain_not_available。缺因果证据，拒绝有依据 |
| valid_quote_no_causal_chain | V/S | V/I拒 | direct换成L6.1根因也未给最早异常产生证据；有quote不等于支持该责任命题 |
| fabricated_node | V/S | X/I拒 | missing_evidence_node＋invalid_evidence；候选伪造ID，未发现提取遗漏证据 |
| cross_case_node | V/S | X/I拒 | 引用不属于当前轨迹；不是原始节点一旦存在就可跨case使用 |
| no_failure_signal | N/A | V/I拒 | failure_claim_not_supported；任务评分failed不证明运行时失败。缺该claim所需源信号，不能反推提取漏了错误 |
| unknown_source | N/A | V/I拒 | failure_claim_not_supported；源明确标unknown，不能归外部责任；未证实是提取丢来源 |
| missing_parent | V/I拒 | V/I拒 | incomplete_source_coverage。确实缺父图，但当前claim仅是该工具返回500、module未知；全局图完整门槛误用于单节点观察 |
| invalid_category_module | V/S | V/I拒 | invalid_category＋invalid_module＋root_cause_chain_not_available；非法词典和责任命题，不是审核误拒 |
| extra_causal_summary | V/S | V/I拒 | unverified_freeform_summary；摘要额外声称内部参数被修改，源无该事实。本例拒绝合理，但当前实现只做字符串门禁而非语义推理 |
| valid_observation_template | V/S | V/S | 规则模板的事故观察，保留不定责 |
| supported_paraphrase | V/S | V/I拒 | unverified_freeform_summary；“外部工具返回500，内部责任未确定”有同一原error与source支撑，仅非逐字模板被拒。属于过度保守策略，不是根因推断能力 |

有合成标签支持的direct观察共3例：missing_parent、valid_observation_template、supported_paraphrase。前两类保守门槛导致其中2例被拒；rules也拒missing_parent。不能把direct全部10个拒绝都称为误拒，更不能只看审核后无非法claim就宣称整体质量提高。

## 逐条审核代码与行号

审计冻结源码路径（与原平台审计时字节一致）：

- 审核：[evidence_review.py](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/baseline/evidence_review.py)
- 适配：[adapter.py](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/baseline/adapter.py)
- 旧纯规则：[rules_pure.py](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/baseline/rules_pure.py)
- 提取：[trace.ts](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/audit/source-snapshot/trace.ts)
- TS校验：[contracts.ts](C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase3/audit/source-snapshot/contracts.ts)

下表行号均为审核文件；JSON的ruleIssueLines保存绝对路径、真实代码行和行号，避免仅凭错误码猜实现。

| 行 | 问题码/判据 | 语义 |
| ---: | --- | --- |
| 46 | invalid_source_contract | 原轨迹结构或值不合法 |
| 50 | invalid_candidate | 候选不是对象 |
| 60 | cross_scope_candidate | 候选自行声明的scope/trajectoryId/digest与原轨迹不同 |
| 62 | unsupported_candidate_fields | 候选带额外字段，不能覆盖源事实 |
| 65 | invalid_status | 仅允许固定诊断状态 |
| 68 | invalid_reason_codes | reasonCodes必须字符串数组 |
| 70 | invalid_category | 固定14类外的类别 |
| 72 | invalid_module | 固定56模块外的模块 |
| 74 | invalid_claim | 非法claimLevel或summary类型 |
| 76 | invalid_references | refs不是有界数组 |
| 82 | missing_evidence | 具体类别/模块/root/resolved却无证据 |
| 94 | invalid_reference | nodeId/field/quote形状或字段非法 |
| 98 | missing_evidence_node | 引用不在当前轨迹节点map |
| 101 | quote_mismatch | 引文为空或不在所指字段规范文本 |
| 108 | invalid_evidence | 无效引用不能支持结论 |
| 111 | root_cause_chain_not_available | 任何root_cause或非null模块都被保守拒绝，当前不自动证明责任 |
| 113—115 | failure_claim_not_supported | 至少一个被引节点的observed_category必须等于候选类别；当前读整个节点，未限定所引字段 |
| 117—120 | unverified_freeform_summary | summary必须逐字属于规则允许模板，不是语义支持审核 |
| 122—123 | incomplete_source_coverage | 全局complete=false即拒所有具体观察，即使失败字段本身完整 |

补充：模块/状态/额外字段错误先累计issue，某些后续分支仍会再给root或类别理由；因此问题码数量不能当独立缺陷数量。safeCandidate只有valid＋supported才返回规约事故观察，任意根因责任仍未被确认。

## 真实HTTP拒绝：信息没有丢在这个错误字段上

当前指定的increment2/http/results.json有4个diagnostic-result：

| case | 实际情况 | 审核 |
| --- | --- | --- |
| case_EMgQQ2Ozv7py | quality评分失败，未取得结构化运行失败 | unknown、N/A，不计拒绝 |
| case_71xg8CyuWSrx | 同上 | unknown、N/A |
| case_UXzmrQeGPZJW | 同上 | unknown、N/A |
| case_2NydKZWYakke | 实际Calculator调用invalid(失败，原error.type=CalculationError；错误文字、参数和工具身份在Trace中 | 存在valid、支持insufficient，唯一理由incomplete_source_coverage |

最后一条job为9db4621b-9297-5cb9-a8ee-918087a6eceb；真实结果节点`message:msg_d8HurSqGsdwnIK`的error记录“Unexpected end of expression (char 9)”；派生call节点`call:msg_ovkTVIEMiYUVTu:0`的arguments为`{"expression":"invalid("}`。这足以观察到“工具执行返回CalculationError”，仍不足以证明最早是谁生成/变换参数，不能提升到L2.2责任。

trace.ts第104行起无条件初始化operation_events_unavailable与provider_request_payload_unavailable，第238行又用warnings.size===0决定complete。因此当前DB导出complete必定false；四条还都有trace_id_unavailable。这不是当前error字段的提取丢失，也不是已经证明父图不完整导致工具失败无法观察，而是缺其他证据层的全局标志否决了较弱的事故观察。

本审计不查询DB、不承诺所有源消息都已完整导出。结论只限存量真实HTTP bundle中已存在的error/call/source。历史before-message-error-persistence-fix等文件不与最新结果合计，不能把已修复旧问题重新当成当前遗漏。

## 六个只读复现探针与潜在错误接受

所有探针只改内存克隆，原文件SHA不变；改变coverage用于定位门槛，绝不是建议伪造真实coverage。

1. missing_parent仅将克隆coverage标为complete，审核由拒绝变接受：隔离出全局门槛。缺父图仍真实存在，根因责任仍未知。
2. supported_paraphrase仅把摘要换回规则模板，审核变接受：证明字符串白名单的影响；事实没变，不能称“重写摘要后根因正确”。
3. **引用字段错配被接受**：同节点error确有500，content改为“This field says the lookup succeeded.”，候选只引content这段成功文字。存在性valid且支持supported。审核第113行限定ref.field名称，却调用observed_category(node)，函数第19—28行读取未引用的error优先生成失败envelope。TS第297行也只做字段包含quote。这里失败事实确在别处，问题是所引字段并未支持命题，不能把此反例说成事故事实本身被伪造。
4. **嵌套业务false潜在假失败**：原error=null，content顶层success=true，data中嵌套success=false及历史失败说明。旧rules_pure.py第37行递归扫描flatten后的所有字段，触发失败，后续审核supported。若内层只是业务数据，不能据此认定工具执行失败；这是合成反例，不是说现有真实HTTP Calculator其实成功。必须明确结果封装层级，不能一概忽略或一概采信所有嵌套false。
5. **多故障聚合被拒**：有完整配对的500与permission两次失败，adapter第142行因多个类别将诊断category设null，审核给failure_claim_not_supported；原两个observations仍保留。不能把“聚合无唯一类别”当每个事故观察都无支持。
6. 同一多故障bundle只审核其中一个正确类别和对应refs，可以supported：这仅是支持该一条观察，不是覆盖所有故障。当前`any`式匹配不要求所有引用都支持该类别，且没有“覆盖全部故障”的合法声明字段；不能据一次supported推整个轨迹类别都正确。

已有合成实验的类别/标注必须注意：缺父链影响责任推断而非必然否定失败观察；category是既有规则签名，不是全部根因；unknown toolSource意味着来源未定而非确定外部；任务failed和运行失败不同；多故障没有唯一类别时需逐项审核。未从本轮材料证实新的生产提取遗漏，不用“可能漏了Trace”替代审核实现问题。

## 仅建议后续实施的两个方向

**1. 按claim强度和需要的证据判断覆盖。** 有限事故观察检查实际结果字段/身份/来源与被引证据；operation/span/provider缺失继续作为原coverage警告，不为提高通过率改complete。root/module责任继续要求最早异常产生链，当前不足就保守拒绝。回归应包含最新HTTP Calculator、missing_parent的有限观察和同源根因断言，确保前者可核查、后者仍不支持。

**2. 支持性绑定实际被引字段与执行结果封装层。** content成功＋未引error不能借其他字段通过；显式顶层success/ok=true与仅业务嵌套false不能被递归当执行失败。保留真实顶层失败、真实error字段的正常观察及字段不存在/quote伪造拒绝回归；多故障先逐项界定支持范围，不凭一个匹配推全轨迹。这是在有限观察上同时减少误拒和错误接受，不是全面放宽。

自由摘要白名单本轮不建议直接移除，supported_paraphrase合理改写仍被拒应作为明确遗留限制。后续即使从已验证结构事实生成规范摘要，也只能表示新生成的事故观察可查，不能追认原LLM的额外因果文本正确，更不能把摘要改写计作根因准确率提升。

## 复现与边界

在项目目录执行：

```powershell
& 'C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B local_checks/2026-11-08_phase3/audit/reproduce_rejections.py
```

脚本关闭bytecode写入，只在本audit目录写JSON，不导入dotenv、不调用LLM/网络，也不读取holdout。JSON保留每个原候选与issueCodes、实际coverage、分类解释、探针输入/输出、完整来源绝对路径/行号/hash；克隆轨迹按这些夹具的规范JSON重新生成派生digest。原版hash变化会直接停止，不会自动换用优化后的算法重写本轮结论。本报告是冻结原版只读审计，不是修复后或holdout验收报告。
