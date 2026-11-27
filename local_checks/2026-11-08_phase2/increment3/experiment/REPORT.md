# 三方案受控对照：规则、直接候选、候选证据审核

## 实验性质

本轮是12例明确标注的合成边界工程实验。真实调用ModelRuntime.generateObject和OpenAI兼容SDK，经HTTP到`127.0.0.1:18088`；Mock只把最后一条请求中的syntheticCandidate原样返回。它没有推理、学习或模型质量能力，下面的比例不是归因准确率、真实模型胜率或泛化效果。

真实模型：**blocked**。当前隔离环境没有确认的真实provider/model/凭据，未调用任何付费模型。direct.ts默认offline，只接受显式localhost、openai和mock-attribution-candidate；real模式直接拒绝，需要后续确认真实配置和实验方案。

历史classifier的SYSTEM_PROMPT与taxonomy ROWS均经AST literal_eval读取，未import classifier、dotenv或加载密钥；56模块分类树及源文件/prompt hash在input.json的promptProvenance。保留原提示作为分类背景，并附本轮新diagnosis合同；真实模型对该新旧提示适配的理解尚未验证，没有复制重建完整classifier。

## 三条实际执行路径

1. 现有Python纯规则：固定bundled Python `-E -s -X utf8`运行rules_raw_cli.py，调用原adapter.analyze。刻意不使用现已附带审核的adapter.main，以区分原规则与后置审核。
2. direct候选：现有ModelRuntime.generateObject→SDK→真实localhost HTTP。保留未经证据审核的完整候选、原始HTTP请求/响应与SDK解析值。
3. 同一direct候选：固定bundled Python运行正式review_cli.py，stdin严格为`{trajectory,candidate}`，完整保留review/sourceDigest/scope/safeCandidate。没有改写候选摘要以凑审核通过。

另外对原规则候选同样执行review_cli，供区分“原规则已安全弃权”与“审核新增收益”。最新一轮12个SDK请求全部200，原始HTTP响应12份，SDK值与预设候选12/12相同，见transport-verification.json；跨case引用确实指向另一个已存在合成case节点。首轮direct.json保留，最终统计使用direct-final.json。

实际命令/退出码：results/direct-sdk-final-command.json（退出0，7.20秒）；Mock分支2项测试退出0，1.22秒。prepare-commands.json记录12次纯规则调用，review-commands.json记录24次正式审核调用，全部退出0。results.json保存每例三方案原始结果，未只保留成功样例。

## 最终统计

人工合成标签独立声明预期观察类别；其中9例原轨迹足以支持“外部工具失败”的有限观察，所有12例均不支持确认内部责任模块。此分母是专门构造的边界集，不能当生产分布。

| 指标 | 纯规则 | direct受控候选 | 同候选经审核 |
| --- | --- | --- | --- |
| 非法类别/模块或引用不存在的结论 | 0/12 | 3/12（25%） | 0/12 |
| 人工标签不支持的结论 | 0/12 | 8/12（66.7%） | 0/12 |
| 审核政策不支持的结论 | 1/12 | 10/12（83.3%） | 0/12 |
| 模块/根因责任弃权 | 12/12 | 9/12 | 12/12 |
| 未给出观察结论 | 3/12 | 1/12 | 11/12 |
| 有支持观察覆盖（9例分母） | 9/9 | 3/9 | 1/9 |

“非法类别/模块或引用不存在”按实际review中的invalid_category/invalid_module或existence=invalid计数；人工不支持按各例预设语义标签计数；审核政策还限制完整覆盖与模板摘要，因此二者分开。弃权也区分责任模块与有限观察，不能把needs_review观察算成已定位根因。

## 每例审核结果

| 合成边界 | direct后的审核 |
| --- | --- |
| 正常且unknown | not_applicable，无新增结论 |
| 外部500错归L2.2 | 引文存在，根因链不支持 |
| 合法引文但指责L6.1 | 引文存在，根因链不支持 |
| 伪造节点 | existence invalid |
| 引用其它case真实节点 | existence invalid |
| 无失败信号却声称外部失败 | support insufficient |
| 工具来源未知 | support insufficient |
| 父节点缺失、覆盖不全 | 完整性政策拒绝 |
| 非法类别/模块 | support insufficient，并记录非法字段 |
| 摘要额外声称内部参数导致500 | 自由因果摘要拒绝 |
| 原规则有限观察模板 | supported，但仍needs_review/moduleId=null |
| 人工标注为事实支持的观察改写 | 摘要白名单拒绝 |

本集没有显示审核相对现有纯规则的增益：规则原本已对所有内部责任模块弃权，9个可观察失败均保留。审核保护了故意构造的不安全direct候选，但只接受1个观察，覆盖明显更低。missing_parent与supported_paraphrase是两例人工标注支持有限观察、却被保守gate拒绝的样例；前者属于完整性限制，后者暴露模板白名单对合理改写的错拒。不能只报拦截率并称“准确率提升”。

## 复跑

先由已有本机服务管理脚本启动加载该Mock分支的18088服务，不能并行重启正在验收的服务。在agent-eval-project根：

```powershell
python local_checks/2026-11-08_phase2/increment3/experiment/run.py prepare
python local_checks/2026-11-08_phase2/increment3/experiment/run_command.py direct-sdk-final ../../../2026-11-08_platform_audit/platform node --import tsx ../../2026-11-08_phase2/increment3/experiment/direct.ts ../../2026-11-08_phase2/increment3/experiment/input.json ../../2026-11-08_phase2/increment3/experiment/direct-final.json http://127.0.0.1:18088/v1 offline openai mock-attribution-candidate
python local_checks/2026-11-08_phase2/increment3/experiment/run.py compare
```

本次只新增Mock固定fixture及其测试，在server.ts增加精确模型名分支，既有Judge/scenario不改。编辑前impact handleChatCompletions为LOW/1上游，原始记录保留。没有安装依赖、添加部署组件或新增产品服务。剩余工作是独立确认真实模型配置、处理合法改写/不完整覆盖的审核策略，再在真实标注集上验证；本轮不预先扩展这些实现。
