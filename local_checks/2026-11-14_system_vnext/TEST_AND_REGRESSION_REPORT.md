# 实际测试总账

| 测试范围 | 实际结果 | 原始证据 |
| --- | --- | --- |
| 11-12新版开发/指标 | 18通过 | results/0-previous18.log |
| 11-10原Shadow | 15通过（原版） | 0-previous15.log |
| 原平台Python | 36通过 | 0-python36.log |
| 原平台TS归因/轨迹/任务 | 71通过 | 0-bridge71.log |
| 本轮Python | 14通过：6证据+8系统/分组 | new-tests.log |
| 本轮TS包装器运行测试 | 6通过，非全库typecheck | integration/test.ts实际执行输出 |
| 原平台runPython→Python sidecar | 1个真实接口演示通过 | ts-platform-demo.json |
| 新证据合同集合 | 12例，4正例；接受4/4，误接受0、误拒0 | evidence-quality.json |
| 语义历史回归 | 48固定候选Mock，非真实模型 | semantic-regression.json |
| 历史/新归并对照 | 103原始/102唯一事件，旧1模式新3 | grouping.json |

0-regression.json含原始命令、cwd、退出码和耗时。13个活跃源码与完整baseline Hash冻结；最终核对未改。不同轮测试不累加成质量分母，也不把相同语义观测算新独立证据。旧15直接用于11-12语义策略曾有3项不适配，原记录保存在baseline；本轮未修改旧断言，不宣称旧策略完全兼容新合同。

红灯日志为新增模块前的导入失败，绿灯六项后通过。一次TS命令相对路径少退一级导致MODULE_NOT_FOUND，修正命令后通过；不是业务修复或测试绕过。首次bootstrap相对Path未resolve导致找不到上轮目录，修正为绝对工作目录后冻结成功；未覆盖任何旧成果。

未执行：新创建真实PostgreSQL Run/Thread→抽Trace的数据库端到端、登录/UI、全平台历史945项、全库TypeScript检查、新供应商模型调用、真实脱敏生产集、独立标注验收。已验证实际runPython和Trajectory合同，不等于重跑完整数据库链。完整Run/评分数据库不变仅有结构隔离与旧测试证据，不能声称本轮又在真实DB测过。

新增真实模型调用0，Token/费用/供应商推理延迟NA。Provider为Mock；Python/TS包装器超时后丢弃迟到结果，不保证外部付费供应商取消。全部弃权Precision为NA。算法和12例数据SHA在正式实验前分别冻结，单作者合同测试不是独立生产质量证明。
