# 评分边界与JSONL解析：第一轮修复记录

工作副本：`../../2026-11-08_platform_audit/platform`。原ZIP、`source-reference`及历史审计结果不改。

## 最终结果

完成最小修复，最终16个测试文件、113项断言全部通过（原89项+新增24项），进程退出码0，8.339秒；见`after.json`、`after.log`和`after-command.json`。所有历史业务断言保留，包括Judge越界clamp断言。

| 修改文件（platform下） | 修复前 | 修复后 |
| --- | --- | --- |
| `packages/eval-rubric/src/evaluate.ts` | 新候选/权重/threshold回归12项失败，合法零权重控制组通过 | 对应13项通过 |
| `packages/eval-rubric/src/matchers/regex.ts` | 非法pattern异常缺乏配置诊断，新增断言失败 | 有明确regex配置诊断，断言通过 |
| `packages/eval-rubric/src/matchers/numeric.ts` | 新增7项中5失败（科学计数与多数字拼接） | 7项通过 |
| `packages/eval-dataset-parser/src/parsers/jsonl.ts` | 物理行号断言失败，preview控制组通过 | 2项通过 |
| `packages/eval-rubric/src/matchers/llmRubric.ts` | 新增0分断言失败，旧13项通过 | 14项通过 |

新增测试文件：`packages/eval-rubric/__tests__/boundaries.test.ts`和`packages/eval-dataset-parser/__tests__/jsonl-lines.test.ts`；原`packages/eval-rubric/src/matchers/__tests__/llmRubric.test.ts`仅追加零分回归。`changes.patch`包含全部差异。

变更前运行实际GitNexus upstream impact，结果位于上级round1目录：evaluate为HIGH（3直接调用者：evaluateCase、evaluateThread、TaskReviewService.review，18个受影响符号）；三个matcher为HIGH（直接调用match）；parseJSONL为LOW（直接调用parseDataset）。主agent已先告知风险。索引为下界、FTS不可用，结果并非完整影响证明。

类型检查尝试：`node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`（在packages/eval-rubric目录），退出码2。跨workspace已有CommonJS/import.meta、moduleResolution与model-bank声明等错误，见typecheck-before/after.log；修复后的日志没有本次改动文件错误。没有声称完整类型检查通过。默认Prettier配置依赖缺失的prettier-plugin-sh，改以本目录无插件配置格式化本次文件，未改项目配置。

## 修复前证据

- `before.json` / `before.log`：新增23项回归，19失败、4通过；真实执行768ms。
- `judge-before-minimal.json` / `judge-before-minimal.log`：原13项+合法零分回归，共14项，1失败、13通过。
- `judge-before.json`是曾探索更严格库级schema契约的结果，最终未采用；保留记录，不计最终修复前后比较。保持原clamp契约，由服务适配器校验Judge结构。
- 普通沙箱下Vitest因`EPERM realpath`不能加载依赖，JSON曾给出0项测试且success=true；没有将0项算通过。上述有效记录均在本机权限下运行，断言数量已核对。

## 根因与最小策略

| 问题 | 根因 | 修复原则 |
| --- | --- | --- |
| 空/非字符串expected数组 | 直接reduce空列表，或把非字符串传给文本matcher | 抛有诊断的配置错误，由服务区分error和答错 |
| 负/非有限weight、全零权重 | 加权聚合前无配置校验 | 拒绝非法权重，保留部分零权重支持 |
| 越界/非有限threshold | 比较前无范围校验 | 拒绝非法threshold |
| regex非法模式 | RegExp编译异常无业务诊断 | 显式配置错误，不改成普通不匹配 |
| numeric科学计数法 | 删除非数字字符把1e3变为13 | 提取完整数字token，支持科学计数/千分位；多个数字拒绝拼接 |
| JSONL错误行号 | 过滤空行后使用下标 | 保存物理行号，preview/totalCount继续按非空记录计数 |
| Judge合法0分 | truthiness检查把0当缺失 | 仅判null/undefined，保留0分解释和原clamp契约 |

## 命令约束

必须使用与历史配置alias匹配的工具目录Vitest（3.2.4），不能混用平台3.2.7入口。

在platform目录运行：

```powershell
node ../tooling/node_modules/vitest/vitest.mjs run --config ../tooling/audit-core.config.mts packages/eval-rubric packages/eval-dataset-parser --reporter=default --reporter=json --outputFile=../../2026-11-08_round1/scoring/after.json
```

配置关闭网络；评分与解析包不调用真实模型或数据库。此结果不代表真实LLM评分质量、HTTP业务链或生产环境全部通过。

可从agent-eval-project目录使用`python local_checks/2026-11-08_round1/scoring/run_regression.py`复跑，脚本保存真实退出码。若在受限沙箱遇到EPERM读取依赖符号链接，需要本机执行权限；不能把零断言当作通过。

## 仍需注意

- 非法评分配置现在抛出有诊断的Error；由本轮服务修复负责转为题目error，而非普通failed，本包单测不能代替服务集成验收。
- 数值匹配只接受文本中的一个完整数字token；推理文本有多个数值时使用已有answer extractor。不再把多个数字拼接；科学计数和逗号千分位有回归覆盖。
- Judge库的原clamp契约保留；新增服务适配器负责严格结构校验。库直接调用的非有限输出治理不在这次扩围。
- 尚未验证真实模型评分质量、云生产工作流、全库类型检查。
