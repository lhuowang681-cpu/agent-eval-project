# Provider适配与预算

已实现integration/provider.ts：复用平台ModelRuntime.initializeWithProvider/generateObject，不增加独立HTTP模型SDK或Python真实Provider。review_candidate.py只审核外部已生成候选，明确modelCallsInPython=0，避免把审核回放算第二次推理。

provider、model、baseURL、Key环境变量名必须显式配置；默认关闭，没有供应商/模型/Key默认值。仅验证OpenAI-compatible Chat Completions路径，不能保证所有原生Provider或Responses API模型可用。远程供应商认证和模型语义效果未验证。

## 已执行的验证

真实ModelRuntime和真实localhost HTTP Mock的10项检查通过：合法结构及usage保留、Python审核接入、持久预算耗尽、根因声明、错误身份、重复观察ID、坏JSON、空响应、超时，以及关闭/零预算/生产来源不发网络。另4项配置边界、5项隔离runner通过。PG Worker另实际使用该适配器1次本机Mock，并将审核结果存入真实数据库。

最终Provider套件7次本机HTTP；所有保留预算账本合计18次本机网络尝试（包含早期失败和重复验收、两轮PG集成）。**新增外部付费模型请求0**。Mock返回的168等Token usage是固定响应值，不是真实模型Token，不用于费用结论。原六次DeepSeek数据仅随快照保留，不计本轮。

## 预算与故障控制

- 默认approvedRequests=0；未明确授权就拒绝，关闭时不构造请求。
- 每个新授权账本最多8请求；本任务没有授予任何paid请求额度。锁文件+持久计数在发送前扣减，失败/超时不返还；不得删除账本重复消费。
- 单请求max_tokens<=800，输入Trace<=12000 UTF-8字节、<=30节点，拒绝超限；这是上下文字节限制，不假装精确Tokenizer计数。
- 总截止<=15秒，AbortSignal和Promise.race；本次Mock使用10秒/超时测试100ms。响应流<=256KB，拒绝重定向、不同源及非chat/completions路径。
- SDK重试不能造成第二次实际网络发送；同实例并发阻断。跨进程争用账本时保守拒绝；崩溃遗留锁需要人工核查，不自动删锁。
- JSON结构、固定观察类别、observation层级、scope/digest、唯一观察ID均校验。输出之后仍需Python证据审核，结构有效不等于事实正确。
- input origin必须synthetic；常见Key/Bearer/email模式外发阻断。该声明不是隐私认证，未经授权/脱敏真实轨迹仍禁止外发。

原SDK structured-output接口没有直接Token上限字段，适配器在统一fetch边界补充max_tokens并删除旧Content-Length。最初失败记录显示沿用旧长度造成请求不完整；修复后服务器确认Token字段及完整body。SDK坏JSON路径会打印原文，因此在返回SDK前先限制并校验响应，HTTP错误体不进入SDK；不记录鉴权头或配置Key。原SDK仍可能打印已脱敏的超时诊断，当前日志没有凭据。

## 尚未批准的真实实验预算草案

建议后续另行批准4次、每次最多800输出Token（总输出上限3200），输入按上述字节上限，15秒截止。当前批准数仍为0。模型和价格未确认，金额估算/实际费用均NA，不能在未定价时承诺货币上限；批准前需确定模型、费率和总金额阈值。真实供应商取消是否停止计费尚未验证。

provider_cli.ts从明确命名的环境变量读取Key，不接受日志中打印Key，不序列化整个环境。真实使用前应核对新授权、ledger、模型与价格；本交付没有启用paid配置。
