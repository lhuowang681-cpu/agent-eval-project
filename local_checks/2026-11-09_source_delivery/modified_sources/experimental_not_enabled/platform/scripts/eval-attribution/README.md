# 单次轨迹规则适配器与证据审核（增量2/3组件）

入口 `adapter.py`；固定协议 schemaVersion=1，stdin一个UTF-8 JSON对象，stdout一个JSON对象加换行。Python标准库，无pandas、dotenv、网络或模型调用。TS应固定Python可执行路径、脚本路径、超时和输入/输出大小，结束stdin。输入最多1MiB、500节点；非法输入退出1并返回jobExecution.failed/diagnosis.error，不返回原始输入或凭据。

本机建议Python：`C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe`。默认anaconda启动shim会额外向stderr输出路径警告，不能把它算作适配器业务错误。

输入合同与主方案冻结的scope/nodes/evaluation/coverage一致；输出固定：

- schemaVersion/trajectoryId/inputDigest/scope原样关联，coverage原样保留；inputDigest由调用方计算和核验，适配器不声称自己重新计算了它。
- jobExecution `{status:completed|failed,errors:[{code,message}]}`；分析器故障独立于原评分。
- diagnosis `{status:resolved|unknown|needs_review|error,category:string|null,moduleId:string|null,claimLevel:observation|root_cause,summary,evidenceRefs:[{nodeId,field,quote}],reasonCodes:string[]}`。
- observations `[{category:string,moduleId:null,claimLevel:observation,summary:string,evidenceRefs:[{nodeId,field,quote}]}]`。
- provenance `{rulesVersion,sourceSha256}`；增量3正式解锁后增加review顶层字段，存在性和支持性分别输出。

首个适配只确认规则观察，不自动推上游责任。故moduleId保持null；观察到失败为needs_review，无支持信号为unknown，而不是“已证明没有问题”。工具来源以TS结构为准，unknown不归external_uncontrollable；系统/用户文本不扫描失败词。真实error字段生成兼容envelope时，quote仍引用原节点error字段的规范JSON表示，而非生成envelope；content quote为原字符串片段。没有恢复推断。

`rules_pure.py`从round1维护版原样抽取8个纯函数及Provider契约，函数AST逐一对照验证，来源路径/hash和复制清单在provenance.json。原件不改。适配器将旧分类输出保守解释为事故观察，不把旧规则的actionability/module责任断言直接搬入平台。

增量2组件基线15项回归保留（含14类规则全覆盖）。阶段整体通过以phase2/INCREMENT_GATES.json为准；该门禁已经明确允许激活增量3。`engine-version.json`现记录增量3版本、adapter字节hash和规则来源hash。

```powershell
& 'C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -B -m unittest discover -s scripts/eval-attribution -p test_adapter.py -v
```

命令在platform根目录执行。原SOURCE_MANIFEST快照、round1入口和既有评分都未修改。增量3 gate之前的staged文件/试验日志仍保留作历史准备证据，不计正式验收；正式激活后的结果在phase2/increment3/python/formal-results.json和ts-bridge/results.json。

## 增量3：两层审核和固定review_cli

adapter的`analyze`仍为纯规则；`analyze_reviewed`执行规则后审核并附review，main调用新层。审核内部只能调用纯analyze，不回调analyze_reviewed，不形成无限递归。原observations保留，needs_review不提升为resolved；未知来源不变成外部责任，source coverage不可由候选替换。

固定review程序：

```powershell
& 'C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' -E -s -X utf8 scripts/eval-attribution/review_cli.py
```

输入stdin单JSON `{"trajectory":原schemaVersion1轨迹,"candidate":不可信候选}`，整个envelope最大1MiB。输出单JSON `{review,sourceDigest,scope,safeCandidate}`。sourceDigest/scope来自原轨迹；候选不能覆盖。无效envelope/源输入退出1并给安全错误，不回显原文；合法输入但候选被拒绝仍退出0，审核结果与分析器故障分开。

review固定结构：`existence:{status:valid|invalid|not_applicable,issues:[{code,nodeId:string|null,message}]}`；`support:{status:supported|insufficient|contradicted|not_applicable,issues:[同结构]}`。

只有存在原节点、quote原字段真实存在、固定类别匹配真实失败、摘要为可核查规则模板的事故观察能supported。第三轮还要求仅用被引用字段/引文本身重检类别，content必须有执行层失败标记；顶层执行成功或只有业务嵌套false不等于执行失败。全局coverage不完整仍原样保留，但不一票否决这种有限观察。存在ID不等于证明最早责任：所有root_cause/module owner命题目前保守insufficient；外部500不证明Agent内部参数错误；任意LLM自由摘要不能只靠类别相同得到认可。保守拒绝允许出现false abstention，这不是LLM语义推理器。

safeCandidate仅在存在性valid且支持性supported时返回规约后的诊断对象：status固定needs_review、moduleId=null、claimLevel=observation，理由来自可信规则；不透传原候选resolved、任意reasonCodes或额外字段。其他情况为null。候选不改变原error_type或其他源事实，也不写原评分。

正式激活后Python36项、原TS桥接42项通过，局部严格tsc通过。TS中唯一阶段性“无review”断言按新功能合同改为具体valid/supported结构断言，其余边界断言未变。完整对比实验由主流程另行运行，不据这些组件测试声称模型质量提高。
