# 独立离线合成 holdout

28个单人手工编写的合成案例，全部为holdout，不提供调参/dev子集。节点、候选整段文字与标签逐例人工指定；Python仅组装身份、digest、无标签投影和校验。没有运行或导入生产审核器/分类器，没有网络或新依赖。

可信度是**单人合成oracle**，不是多标注员真实案例标注，也不是实际系统故障复现。因果真值来自作者在合成世界中预先指定的局部变异；未实际对平台实施这些变异。作者已有项目上下文，阅读了phase2冻结的公共v1合同、节点fixture及原56模块字典；未查看本轮优化代码、未用审核器生成/修正标签，不能宣称作者对整个项目完全盲审。

## 文件与冻结顺序

- `inputs.jsonl`：正式审核输入，每行只有id/origin/trajectory/candidate；没有labels。
- `private/cases.jsonl`：每行完整原始记录，含人工labels。
- `private/build_holdout.py`：人工卡片和标签的可复现源码，属于私有oracle。
- `validate_holdout.py`：独立stdlib结构/身份/标签一致性/无结构性泄漏/冻结hash校验器，不推断语义标签，也不调用审核器。
- `test_validation.py`：校验器负向测试，验证错误投影、篡改digest、泄漏模块字面量与不一致标签会被拒绝。
- `split-manifest.json`与`MANIFEST.sha256`：冻结输入、人工oracle、构造源码和校验器，禁止看到结果后替换。

主agent提供的优化冻结元信息：UTC `2026-11-08T10:06:58.388469+00:00`，决策SHA256 `0098085e2a8b10112b37ee52a55ededfe5cf1bc0182df1612c3ec99f7e67f7a9`。本作者只记录这条元信息，未打开优化实现。原28例先独立编写；之后按评估合同补充两个canonical支持标签，未运行任何算法。正式holdout只在优化冻结后回放一次，不据结果调整算法或oracle。

## 标签的严格含义

`candidate`是原diagnosis对象本身：status/category/moduleId/claimLevel/summary/evidenceRefs/reasonCodes。不是完整Diagnostic包装。候选可以错误、过度归因、引用不充分，甚至含不存在的节点；这些是需要审核的输入，校验器不会替候选修证据。

- `candidateCorrect`评价**原候选完整文字语义**，包括“唯一”“已经证明”“排除本地错误”等断言，不按命中的一句正确片段计分。无正向claim的unknown设null，不能当正确根因。
- `candidateSupported`评价**原候选整段命题是否由其给定refs及对应节点上下文充分支持**。因果真值碰巧正确，支持性仍可能不足；两个布尔轴不能互相替代。无claim时false表示没有待支持的正向命题，不表示弃权策略错误。
- `safeCanonicalSupported`仅评价固定有限重写：保留candidate.category和其已有refs，只说观察到该类别失败，不保留根因、唯一性、恢复、责任排除等断言。必须结合所引节点的角色、真实失败状态和source；不能因为有关键词就给true。如果重写器改变category或证据范围，这个标签不自动适用，需另行人工评定。
- `ruleCanonicalSupported`评价完整trajectory是否支持有限失败观察，本数据与人工observationEligible一致。回放时仍须检查输出类别属于observationCategories；不能给一个选错类别的输出无条件授予支持。
- `observationCategories`可以多值；只针对公共合同的14类失败观察，不等于所有可能的语义答错。没有这14类信号的失败答案可合理弃权。
- `root.known=true`来自预定合成机制，不由被测分类器决定；moduleId可null，表示已知外部机制而不是内部模块。known=false时两个目标均null。隐含机制只放私有标签，不写进输入。
- 正确有限观察可以有candidateCorrect=true，但**不是root正确**。根因指标必须另筛claimLevel=root_cause、root.known=true、目标匹配与支持性，不能把观察准确率包装成根因准确率。

轨迹中的结构化运行时审计记录在合成世界中视为原始事实；assistant/user正文只是其文字，不因此成为可信因果声明。部分轨迹显式complete=false及warnings；不虚构缺失的调用侧或服务端记录。

## 独立校验与复现

在本目录运行：

```powershell
python validate_holdout.py
python -m unittest -v test_validation.py
```

检查包括v1严格字段、唯一身份/节点、scope/trace引用、完整轨迹调用配对、canonical digest、标签类型与目标自洽、无labels投影、轨迹内无模块目标字面量、冻结文件hash。它不能证明人工语义标签无偏或无误；保留最终人工复核的限制。

冻结后不重新运行builder或freeze脚本覆盖数据。若发现数据缺陷，应新建版本并披露，不能静默替换本次holdout。
