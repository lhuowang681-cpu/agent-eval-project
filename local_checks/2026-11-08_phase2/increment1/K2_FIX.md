# 真实HTTP验收发现的K=2阻塞与修复

首次真实PostgreSQL/HTTP证据由主任务保存在http/results.json及其首次失败副本：run_x7sVbng0jLFf仍running。原始失败不能删除或改成成功结果。

根因：executeThreadTrajectory本地onComplete hook调用recordThreadCompletion，却丢弃allRunDone。评分/线程聚合完成后没有调用finalizeRun。K=1上一轮已修复同型问题，K=2当时没有对应本地hook回归。

最小改动：allRunDone时复用现有AgentEvalRunOrchestrator.finalizeRun，不改队列、编排架构或Mock测试绕路。额外保护K=1/K=2中execAgent在onComplete之后才返回operationId的时序：终态不再被opID元数据写入覆盖；pending行通过条件JSONB merge、线程事务通过metadata merge保留已有数据。updateByRunAndTopic通用行为不变。

修改文件：

- src/server/services/agentEvalRun/index.ts：K2完成hook与两处operationId写入。
- packages/database/src/models/agentEval/runTopic.ts：现有本轮新方法updateIfUnfinished可选JSONB merge（仅operationId处启用），线程元数据合并；仍拒绝终态/已completedAt行。
- 新增localThreadCompletion.integration.test.ts：规则/Judge两模式×顺序/并发三题六线程，以及K1/K2同步onComplete先于execAgent返回的真实服务回归。

编辑前GitNexus impact：executeThreadTrajectory LOW4，direct3；executeTrajectory LOW5，direct3。新原子方法不在旧索引中，静态调用点已核对，本轮模型HIGH传播风险此前已告知。证据impact-execute*.json。

红→绿真实结果：

- local-k2-before.json：新增5项全失败（K2四路径均卡running；迟到operationId抹掉线程评分）。
- local-k1-before.json：新增K1迟到opID测试失败，其他5项按名称过滤未运行。
- local-k2-after.json：6项新增+2项已有K1本地完成测试，8/8通过，31.04秒。
- post-k2-regression.json：完整服务/配置144/145通过，唯一失败为原trajectoryMethods要求初始rubricScores=[]。没有修改该原断言；JSONB合并改为先给默认空数组、再合并已有JSON、最后opID，保留旧合同和已有结果。
- pending-merge-regression.json：2/2通过，另6项名称过滤未执行，验证pending Topic/Thread既有数据不被opID擦除。
- post-k2-targeted-final.json：SQL默认值修正后的local hook/trajectoryMethods/late Judge三文件41/41通过，66.22秒。含新增两个pending元数据合并用例。
- final-after-k2.json：最后再次完整执行服务与配置回归；完成情况以该文件为准，不能删除前一次144/145失败记录。

root负责重启真实Mock/Next/PostgreSQL演示环境并重跑完整HTTP/K2；上述服务回归使用PGlite、execAgent/ModelRuntime替身，不能代替真实HTTP验收。first failure和后续结果分别保留。
