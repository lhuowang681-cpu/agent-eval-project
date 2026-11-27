# 误拒绝、错误归因与标注歧义分类

本表区分实际触发规则与可能的后续门禁。不会把第一个拒绝原因改写成“主要因为摘要白名单”。存量原版19条规则见audit/REJECTION_AUDIT，独立集逐例问题码见results/holdout/*-outputs.json。

| 类型 | 典型案例/证据 | 判定与状态 |
| --- | --- | --- |
| 源因果链缺失 | 外部500推L2.2或L6.1；没有最早异常生成证据 | 引文存在但根因不支持，拒绝合理；事实真伪未必可判，不自动计错误根因事实 |
| 源来源未定 | unknown toolSource | 无法归external；未证实是提取器漏字段，不凭工具名补来源 |
| 当前提取遗漏 | 历史error落库/来源type旧问题 | 上轮已修，不能重算当前缺陷；本轮未证实新的生产提取遗漏。数据库导出缺operation/provider需如实标注 |
| 全局覆盖误判 | 最新受控Calculator error/call俱在；dev-missing_parent | 全局complete=false不应抹去单节点有限观察。候选局部改善，因整体验收未通过未推广 |
| 摘要逐字门禁 | dev-supported_paraphrase | 事实和引文正确，仅非模板被拒；仍未解决，不据此说根因已知 |
| 非法/跨scope证据 | 旧fabricated/cross_case；ho-028 | 缺节点或不属于当前bundle，引用拒绝正确；引用无效和原事故事实错误是两件事 |
| 字段错借 | content说lookup succeeded，未引error确有500 | 原版错误支持引用，有限事实可能真但该证据指向不支持。候选能阻止；仅合成克隆探针，不说现有真实运行成功被误标 |
| 封装层混淆 | success=true、data.success=false | 业务数据与执行失败混同，原版递归flatten潜在假故障；纯规则本轮未改，候选审核有防护但未推广 |
| 分类器依赖导致误拒 | ho-001的503、ho-010不可用工具、ho-011解析失败 | 标签支持具体类别，旧关键词规则只给fallback，完整审核要求同规则类别因而拒绝。不是Trace必然缺失，也不是证明LLM实际可解决 |
| 证据片段过严 | ho-003/005/008/026；测试后permission denied兼容探针 | 同字段的摘录可借该字段明确失败封装解释；候选隔离片段会丢语境。独立总体原/候选都拒，但后验探针证明原可接受输入退步，不能推广 |
| 根因政策无差别弃权 | ho-013/014/015/017/018/019等 | 合成标签提供明确机制，某些refs被作者标足以支持；审核任何root/module都拒。体现当前能力边界，不能靠高弃权获得根因准确率 |
| 聚合强度不明 | 多故障category=null；后来另一tool成功 | 多个观察可各自支持，但无唯一顶层类别；别把任意后来成功当原任务恢复，也别将一个匹配节点当整条轨迹结论成立 |
| 标注/类别粒度歧义 | 12条实际规范输出为generic fallback，oracle列具体子类 | 当前字典未定义上位类兼容，内部代理裁决correct/support=null；原标签不改，单独报告，不伪装12错或12对 |
| 标签来源/独立性不足 | 历史脱敏命名XLSX、单作者合成oracle | 文件名不是脱敏验收，根因责任列不是可信gold；本轮保留来源限制，不导入真实敏感行 |

独立集原版和候选完整审核都无输出。13条正确且有支持的原候选都被拒；其中包含有限观察与已有合成因果标签的root，二者不得混报成13个真实内部根因漏判。

独立集候选实际issue统计：root拒15次，failure_claim_not_supported 9次，缺节点与invalid_evidence在同一例各1次；无claim UNKNOWN另列，不计拒绝。不同规则是顺序短路，问题码数不等于独立bug数。原版与候选问题码分布分别保留在QUALITY_RESULTS.json，不能拿候选第一门禁替换原版拒绝理由。

原版的可复现审计脚本为audit/reproduce_rejections.py（固定SHA，不加载当前平台）；8条开发红绿探针在regression/test_quality_policy.py。新出现的兼容退步由experiment/posthoc_compatibility.py单独诊断，明确是测试后探针，不混入28例独立质量成绩。算法及冻结oracle未据此再调参。
