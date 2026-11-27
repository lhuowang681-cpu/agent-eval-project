# 默认Inbox无法创建评测：后端别名解析修复

## 根因

真实登录页面RunCreateModal默认选项发送`targetAgentId=inbox`。这是会话/内置Agent别名，不是agents表主键。原createRun直接把别名传给仅支持主键的snapshotAgentConfig并写入run/topics，真实PostgreSQL抛23503 `target_agent_id_agents_id_fk`。原updateRun也直接写该值，同样受影响。

证据由主流程保存在`../ui/attempt6*`和`../http/next.log`；该问题属于产品后端缺陷，不是浏览器夹具或数据库替代限制。

## 最小修复与文件

- `platform/src/server/services/agentEvalRun/index.ts`：新增小方法resolveTargetAgentId。仅当值是INBOX_SESSION_ID，调用已有AgentService.getBuiltinAgent取得/创建当前用户实际Inbox；普通主键、null、undefined原样返回。
- 同文件createRun先解析，再以真实主键创建快照、run和预建topics，三处保持一致。
- `platform/src/server/routers/lambda/agentEval.ts`：updateRun对可修改的targetAgentId调用同一个解析方法，保持原状态限制与省略/null语义。
- 新增`platform/src/server/routers/lambda/__tests__/integration/agentEval.inboxAlias.integration.test.ts`，经真实tRPC caller/服务/数据库覆盖创建与更新。
- 没有更改前端默认Agent，也没有在演示脚本里强行绕开别名。

## 修复前后证据

`before.json/log/command`：4项测试，3失败（已有Inbox别名、首次Inbox、更新别名），普通真实主键控制组通过；真实退出码1，36.62秒。

`after.json/log/command`：4项全部通过，真实退出码0，30.77秒。覆盖另一用户Inbox隔离、当前用户真实ID/快照/topics一致、首次持久化、update别名/省略/null、普通主键保持。

编辑前实际执行GitNexus：createRun为UNKNOWN/未解析边；updateRun匿名tRPC回调未找到，补查agentEvalRouter仍UNKNOWN。记录在impact-*.json。随后静态核对两个tRPC入口和service→model/topics/快照调用链，按中等风险实施；没有把工具零边当作零影响。

## 复现

在platform目录使用本轮相同合成测试环境运行：

```powershell
node node_modules/vitest/vitest.mjs run src/server/routers/lambda/__tests__/integration/agentEval.inboxAlias.integration.test.ts --environment=node --maxWorkers=1
```

本目录run_command.py可清理运行环境、提供合成数据库及KEY_VAULTS_SECRET，并保存真实命令、退出码和耗时；超时600秒。测试数据库是现有PGlite实现；真实PostgreSQL+HTTP+默认Inbox由主流程另行验收。

完整最终回归分别保存在service-final.json和router-final.json，命令/耗时/退出码在results目录，输出在logs目录。最终机器结果：服务组95/95通过，退出0，169.35秒；路由原两文件+新增Inbox文件58/58通过，退出0，61.54秒。均使用node环境、2workers、hookTimeout=60000、testTimeout=20000；未以登录后页面验收替代这些回归，也未以这些PGlite回归替代真实PG验收。

## 未扩展的既有边界

原updateRun更换目标Agent后不会刷新创建时agentSnapshot，也不重建预建topics；本轮只补相同别名解析，未重做配置版本语义。创建新run的快照与实际Agent ID已回归验证。历史run冻结/修改规则需后续单独定义，不能据本轮声称全部历史快照语义已完善。
