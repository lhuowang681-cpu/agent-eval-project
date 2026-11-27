# 增量2 TS↔Python边界验收

最终冻结结果：42/42通过，两个测试文件局部严格TypeScript检查退出0。真实命令、退出码和耗时在command-results.json；Vitest机器结果results.json，最终日志final-after.log/typecheck.log。不把组件结果等同于DB导出、任务API或第二阶段整体已验收。

修改范围仅平台 `src/server/services/agentEvalAttribution/__tests__/contracts.test.ts` 与 `python.integration.test.ts`；此目录保存执行配置与证据。业务修复由主agent实施，未修改Python冻结适配器，也未激活增量3。

## 范围与真实/替身划分

- contracts.test.ts：15项，包括全部56合法模块、非法类别/模块/状态/字段、schema/ID/scope/inputDigest/coverage关联、真实节点及quote存在、Unicode嵌套error、稳定digest及输入不变。
- python.integration.test.ts：27项，其中13次真正启动固定adapter.py并从stdin/stdout完成成功请求，覆盖正常外部失败、Unicode嵌套error、unknown来源、2组跨语言表示反例和8组数值边界；另实际尝试无效Python可执行文件和实际读取engine指纹。
- 子进程边界替身仅用于可控触发超时、非零退出、stdout超过1MiB、stderr超过32KiB、额外stdout日志、假输出的身份/证据/schema/执行状态错误。真实成功路径没有替换Python、规则或证据校验。
- 固定入口和runner参数保持原合同：只允许executable/timeoutMs；没有为测试新增任意scriptPath，没有shell拼接。进程失败和成功都检查输入/原评分不被修改；无效超时/大输入在spawn前拒绝。

## 根因与前后

| 问题 | 修复前证据 | 根因及主agent修复 | 修复后 |
| --- | --- | --- | --- |
| 合法数值error被误拒为伪证据 | edge-before.log中0.000001/1e-7真实Python回归失败 | contracts.evidenceText使用JS数字表示，与Python json.dumps的1e-06/1e-07不同；主agent增加按实际JSON wire类型的Python数值格式匹配 | 原断言不变通过，新增1e-4/1e-5/1e20/1e21/-1e-5/-1e-7/1.2e-4/1.23e22全部真实Python通过 |
| 合法Unicode键顺序被误拒 | edge-before.log中\uE000与😀键的真实Python回归失败 | JS默认UTF16排序不同于Python Unicode codepoint；主agent增加对应比较 | 同一真实回归通过，未绕开quote校验 |
| NaN deadline启动进程后意外1ms超时 | timeout-before.log：预期invalid_timeout，实际python_timeout | NaN绕过仅大小比较，主agent增加Number.isInteger校验 | 同一回归通过，且确认未spawn |

正常31项基线通过保存在normal-31-passed.log；加入两项有效JSON表示反例后31通过2失败（edge-before.log）；加入NaN及8数值扩展后41通过1失败（timeout-before.log）；修复完成42/42。不是通过删除或放宽失败断言获得全绿。

## 重复运行

在agent-eval-project目录执行：

```powershell
& 'C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe' local_checks/2026-11-08_phase2/increment2/bridge-tests/run_checks.py
```

运行器固定platform工作目录与最小运行环境，执行两个文件的Vitest及其依赖的局部严格tsc，不跑全仓测试。配置不加载应用全局setup，因此此处不证明登录/数据库/HTTP任务流程。主流程须另行验收它们。

## 环境限制

沙箱内Vitest读取其node_modules realpath时曾被EPERM阻止，未能收集测试，日志保留sandbox-environment.log。沙箱外相同局部测试执行成功；这是权限限制，不能记为产品失败。实际Python使用固定bundled可执行文件；默认anaconda shim会输出环境警告，测试验证小量stderr不会被当stdout或暴露给诊断结果。

局部tsc已通过，不声称全库typecheck通过。仓库Prettier配置因缺少prettier-plugin-sh不能执行，本轮未为格式检查扩装依赖；不将其算成业务测试通过。
