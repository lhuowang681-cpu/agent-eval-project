# 压缩策略核查与 Judge 最小接入范围

## 压缩

原始代码 `DEFAULT_THRESHOLD_RATIO=0.65`。原始平台的 `docs/analysis/05-functional-report.md:60–80` 已记录：实现和测试均来自初始提交 `94dd700`，比例已从 0.5 调为 0.65；明确要求后续 long-context 场景按 65% / 83,200 tokens 设计。原始源码并无本地 git 历史，因此不能追溯最初产品决策人或宣称 65% 经性能实验验证。

本轮选择保留现有运行策略 65%，同步两处过时注释和四处旧测试预期，额外覆盖 70,000 不压缩、83,200 不压缩、83,201 压缩，以及显式指定 50% 仍然生效。不是改变实现来迎合旧断言。

修复前原包全量（仅 agent-runtime 包）真实结果：258 项，254 通过，4 失败，见 runtime-before-red.json。首次沙箱运行存在 EPERM 导致 0 tests，不能使用 JSON 内 success:true 判断通过；该失败尝试也保留。

## Judge

两处服务调用 evaluate 仅传 passThreshold，没有 matchContext.generateObject。现有 TaskReviewService 已通过 initModelRuntimeFromDB + generateObject 做结构化输出，无须新增 Python 或 Judge 框架。

本轮范围：仅显式配置 model/provider 的 llm-rubric 复用现有 runtime；缺配置、调用失败、非法结构归入 error，防止算成答错；规则评测不初始化 Judge。不默认选择模型，也不访问真实付费接口。生成质量、真实供应商、预算/超时与提示注入防护仍需下一阶段验证。

原 recordTrajectoryCompletion 的评分 catch 只打印日志，不会更新 error；线程路径评分无 catch，聚合又将无通过的线程统一判 failed。因此必须同时处理两条评分错误路径及线程聚合，才能避免 run 卡住和统计污染。
