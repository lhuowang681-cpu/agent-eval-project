# 真实Provider Smoke：首条失败，按预注册停止

使用用户此前提供的DeepSeek凭据，经隐藏输入只传给子进程。此次授权范围为最多6次Smoke、总费用上限$0.05，不包含40例正式实验。Key未写代码、配置、日志或结果。

**实际1次请求。HTTP200，返回模型deepseek-flash，JSON语法有效，但候选合同不合格。**首条parameter_closed开发正例返回：

```json
{"schemaVersion":1,"decision":"abstain","observations":[]}
```

缺少scope/inputDigest。适配器在统一HTTP边界的结构校验阻断，没有补填身份、降低schema要求、把无效输出传入审核或写成支持事实。该例有明确闭集参数违规，但没有输出观察，不能将它记为正确弃权。

原始脱敏供应商响应、Trace、错误和usage保存在results/real-smoke.json，逐例运行状态见smoke-cases.csv，裁决见SMOKE_VERDICT.json。真实调用证明凭据可用和供应商接口可达，**不证明结构正确、语义归因可靠或LLM增量成立**。

配置使用原ModelRuntime、冻结原Prompt及审核，仅传输层按官方接口启用json_object并关闭thinking；原版与适配差异已在调用前保存并冻结。json_object只保证JSON形式，不强制业务字段，原SDK附带的schema不能视为供应商强制约束。此次模型没有遵守完整顶层合同，不能简单归咎Key，也不能据一个失败判断模型在所有场景无效。

原计划剩余5个Smoke未执行；正常、恢复、证据不足弃权行为尚未真实验证。真实超时/异常响应场景没有出现，相关边界只有已有本机Mock证据。按“首个失败即停、不切换模型或Prompt”的预注册规则停止；没有自动重试，没有运行正式40例。

没有修改冻结Prompt、审核规则、Gold或返回合同来凑通过。后续若处理输出合同，必须以新版本记录设计/差异和新的验证，不能把当前失败结果改成成功。本轮不实施该改动。
