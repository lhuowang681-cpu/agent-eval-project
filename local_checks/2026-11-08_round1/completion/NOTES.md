# 本地Agent运行完成后评测run永不结束

## 真实HTTP发现与根因

真PostgreSQL首轮HTTP记录见`../http/http-three-case-eval.json`：三个RunTopic均passed且score=1；run却始终running，completedCases=3、passedCases=3，但passRate与averageScore都为0。不存在上轮PGlite Socket协议错误。这次是业务链缺陷。

`src/server/services/agentEvalRun/index.ts`的`executeTrajectory`注册本地onComplete handler，原来只调用`recordTrajectoryCompletion`并丢弃其allDone。这个方法只回写逐题评分与实时计数，不负责run最终状态与完整聚合。队列/webhook路径会经过`AgentEvalRunOrchestrator.onTrajectoryComplete`，在那里allDone触发finalizeRun；本地HookDispatcher直接执行handler，不发送webhook，因此永远遗漏finalize。

## 最小修改

- 修改文件：`platform/src/server/services/agentEvalRun/index.ts`，仅executeTrajectory本地hook增加allDone分支。
- 获取allDone后，动态导入已有orchestrator、create(userId)，await既有finalizeRun。复用现有聚合/aborted判断，不增加另一套评分或状态机。
- 动态导入延迟至全部完成，避免引入静态index↔orchestrator初始化循环。orchestrator构造器原为私有，使用既有工厂，不改变构造契约。
- 新测试：`platform/src/server/services/agentEvalRun/__tests__/localCompletion.integration.test.ts`。
- 编辑前运行GitNexus upstream impact：LOW，3个直接调用者、共5个受影响符号。详见impact-executeTrajectory.json；索引为下界，FTS未安装，不宣称完整调用覆盖。

## 真实回归

| 记录 | 结果 |
| --- | --- |
| before.json / before-harness.log | 首次测试夹具加载遇server环境检查，0项，不计业务红 |
| before-red.json / before-red.log | 隔离无关模型初始化后真实2项均失败：运行状态仍running |
| after.json / after.log / after-command.json | 2项均通过，进程退出0，122.74秒 |

两项分别测试顺序和并行的三题本地callback；顺序模式首题后仍running，全部完成后completed、passedCases=3、completedCases=3、averageScore=1、passRate=1；两项均重复发送最后一题callback，确认完成状态和指标保持。Agent exec被替身捕获hook，数据库/评分/聚合/finalize是真实现（PGlite）；不是该测试证明真实PG HTTP已通过，后者由主流程单独重跑。

在platform目录复跑：

```powershell
node node_modules/vitest/vitest.mjs run src/server/services/agentEvalRun/__tests__/localCompletion.integration.test.ts --maxWorkers=1
```

使用与本轮其他服务测试相同的合成数据库/KEY_VAULTS_SECRET等环境；可通过`../compression_judge/run_command.py`清理环境并保留命令退出码。并行3回调及重复回调有回归，不等价于生产多实例故障注入或持久队列验证。
