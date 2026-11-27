# 待批准预算：仅Smoke，不含正式40例

目前批准数=0，新增真实供应商请求=0。BUDGET_AUTHORIZATION.json仍为approved=false。

拟用既有ModelRuntime的OpenAI兼容入口，模型deepseek-flash，供应商https://api.deepseek.com，关闭thinking，JSON Output，原Prompt与审核不改。旧适配器副本只增加可审计的传输参数与响应记录，差异见integration/provider-transport.patch；旧交付不动。

官方文档说明JSON Output使用json_object，thinking默认开启，因此显式关闭以控制本轮消耗。来源：[JSON Output](https://api-docs.deepseek.com/guides/json_mode/)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。实际供应商兼容性仍须Smoke验证，文档阅读和本机Mock不冒充真实验证。

## 本次申请

| 项目 | 申请值 |
| --- | --- |
| 阶段 | 仅Smoke开发样例 |
| 实际网络请求 | 最多6次，失败也占额度，不自动重试 |
| 输入 | 每次Trace<=12000 UTF-8字节、<=30节点，另含固定Prompt |
| 输出上限 | 每次800 Token，总4800 |
| 估算输入预算 | 保守按每次14000 Token预留，总84000（不是实测Tokenizer结果） |
| 合计估算Token上界 | 88800；真实usage另记，常规实际可能明显较少 |
| 超时 | 每次15秒；异常即停止，不自动换模型/Prompt |
| 预计最保守调用费用 | 约$0.03096 USD，未计缓存折扣 |
| 申请支出上限 | $0.05 USD |
| 40例正式实验授权 | 0次，另行申请 |

按查询时[DeepSeek官方价格](https://api-docs.deepseek.com/quick_start/pricing/)，Flash高峰每百万输入未命中$0.30、输出$1.20；估算为84000×0.30/1e6+4800×1.20/1e6。输入预算是保守预留，不是假称已精确测得Token或已有实际账单。供应商实际扣费须复核，响应无账单则actualBill=null。

发送前逐次预留$0.00516，累计不得超过批准上限；SDK物理请求发送前持久扣次数，失败不退还，SDK网络重试阻断。持久账本不删除。正式40例的模型、费用和数据质量需要Smoke后重新说明，本次不得顺带执行。

调用仅合成开发Trace，Key只从VNEXT_DEEPSEEK_API_KEY进程环境读取，不写代码/报告/配置；不输出请求鉴权头，响应审计脱敏。没有已授权Key或授权文件时执行程序直接阻断。

**执行前需要用户明确批准：“仅6次Smoke，最多0.05美元，不包含40例正式实验”。该请求来自用户本轮第3节的明确授权要求，不是额外推定的审批流程。**
