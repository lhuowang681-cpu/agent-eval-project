# Calculator calculate结构化错误证据丢失

后续真实HTTP另定位到MessageModel.create的第二层持久化遗漏；新增两行修复与CRITICAL影响分析、17项真实数据库回归见`message-create/NOTES.md`。下文128项结果只属于calculator适配层，不能替代该持久化验证。

## 根因与已核查链路

1. `packages/builtin-tool-calculator/src/executor/index.ts`的calculate使用真实mathjs解析表达式。失败被转成返回值：`success:false`、`error:{type:'CalculationError',message:原始错误}`，不是继续throw。
2. `packages/builtin-tool-calculator/src/ExecutionRuntime/index.ts`的calculate原来只返回content/state/success，遗漏result.error；由于executor已捕获异常，runtime的catch不会执行，catch内原有error字段不能补救。
3. `src/server/services/toolExecution/serverRuntimes/calculator.ts`创建并注册CalculatorExecutionRuntime。
4. `src/server/modules/AgentRuntime/RuntimeExecutors.ts`的两个工具落库分支（本次核查位置1082/1361附近）依赖`executionResult.error`设置pluginError。上游漏字段就无法保存结构化错误证据；不能靠回答内容中的error词补造证据。

## 最小修复

仅修改`packages/builtin-tool-calculator/src/ExecutionRuntime/index.ts`的calculate返回对象，新增一行`error: result.error`。没有改RuntimeExecutors、其它calculate逻辑或其它工具方法。

新增回归`packages/builtin-tool-calculator/src/ExecutionRuntime/index.test.ts`：真实表达式`invalid(`先调用真实executor得到CalculationError，再调用runtime检查success=false、type/message/content原样保留；正常`2 + 2`检查success、content=4、state与无错误兼容。没有Mock executor或用文本推断失败。

## 真实测试结果

| 记录 | 结果 | 实际退出 | 耗时 |
| --- | --- | --- | --- |
| before.json | 新增2项中1失败、1通过；失败为error从原对象变成undefined | 1 | 3.70秒 |
| after.json | 原有126项+新增2项，128/128通过 | 0 | 5.91秒 |

日志位于logs目录，命令与真实退出码在results目录。Prettier仅检查新增测试，通过；项目默认缺失插件配置未改。

## 影响分析

修改前实际运行GitNexus路径消歧：calculate为UNKNOWN（动态方法调用未解析，不当作无调用），CalculatorExecutionRuntime类为LOW、2个直接上游：包index导出与serverRuntimes/calculator注册；共21个间接相关符号。原始结果见impact-calculate.json与impact-runtime.json。索引为下界，FTS未安装，不能称完整影响图；结合已核查注册与落库调用链后向主agent报告，得到最小一行修复授权。

## 复现与验证边界

在platform目录运行：

```powershell
node node_modules/vitest/vitest.mjs run --config ../../2026-11-08_phase2/increment2/tool-error-evidence/vitest.config.mts
```

该配置只运行计算器包局部node测试，不放宽任何断言。它验证真实数学库、executor与runtime适配层，未单独证明真实PG的message_plugins落库或最终归因展示；这些由主流程受控HTTP工具失败测试另行验收。

其它builtin未扫描、未验证；其它计算器runtime方法的结构化错误透传也没有据此宣称已通过。原126项主要覆盖已有executor数学功能，不能代替所有runtime方法的错误持久化测试。
