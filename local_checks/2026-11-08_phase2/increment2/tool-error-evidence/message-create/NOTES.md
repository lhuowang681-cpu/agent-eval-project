# MessageModel.create忽略pluginError：必要的第二层持久化修复

## 真实HTTP定位

修复calculator runtime透传后，主流程重启并复测真实工具调用，日志中executionResult.error已经存在CalculationError/type/message，但SQL的message_plugins.error仍为null。这证明上层透传不足以说明证据已持久化，也不能用content中的错误词代替结构化错误。

源码核查：MessageModel.create的参数解构遗漏pluginError，随后tool角色的message_plugins INSERT也未包含error。字段落入...message却不属于messages表，Drizzle未写入该字段，结果静默丢失。

## 风险与最小修复

编辑前真实GitNexus upstream impact按路径消歧：

- MessageModel.create：CRITICAL，3直接上游、5个流程、30个受影响符号。包含AiAgentService.execAgent、lobeAgent runtime及服务消息入口，不能当普通局部函数。
- MessageModel类：CRITICAL，77直接上游、15个流程、180个受影响符号。

完整输出在impact-create.json和impact-MessageModel.json。图为下界、FTS未安装；先向主agent报告CRITICAL，主agent明确告知用户后才实施。

`packages/database/src/models/message.ts`仅新增两行：

1. create参数解构pluginError，避免其继续进入messages字段集合。
2. 原tool插件INSERT中新增`error: sanitizeNullBytes(pluginError)`。

保留原事务、角色判断、普通消息/正常tool字段、batchCreate/update等其它方法。已有sanitizeNullBytes与pluginState/arguments使用同一入库策略；错误对象正常Unicode不变。

## 回归证据

只在原`packages/database/src/models/__tests__/messages/message.create.test.ts`追加一项：真实Model.create传原生CalculationError对象（含中文与λ），直接查询message_plugins.error及Model.queryByIds的pluginError，两处都应与输入完整相等。没有mock数据库、改旧断言或从错误文本构造结构化证据。

| 记录 | 完整create测试文件结果 | 实际退出码 | 耗时 |
| --- | --- | --- | --- |
| before.json | 原16项通过，新1项失败：stored.error=null | 1 | 19.05秒 |
| after.json | 原16+新1，17/17全部通过 | 0 | 21.33秒 |

原组包括普通消息、正常tool及关联数据创建行为，保持兼容。日志在logs目录，真实命令/退出在results目录；测试通过后只整理新增测试的换行格式，断言和业务代码未再改变。

在platform/packages/database目录复跑：

```powershell
node ../../node_modules/vitest/vitest.mjs run src/models/__tests__/messages/message.create.test.ts --environment=node --maxWorkers=1 --hookTimeout=60000 --testTimeout=20000
```

本组用真实PGlite/Drizzle，不替代真实PG/Next HTTP的最终证据。主流程另保存修复前HTTP日志和SQL inspection，并重启Next复跑同一失败工具链，避免workspace开发缓存混淆。其它builtin、batchCreate、所有消息路径未因此被声称全部验收。
