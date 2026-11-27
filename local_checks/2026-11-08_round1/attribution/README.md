# 第一轮：独立 JSONL 归因脚本修复

这里是本轮可运行修复副本，入口为 `structured_jsonl_attribution.py`。原 `source-reference/attribution/structured_jsonl_attribution.py` 是审计证据快照，未覆盖；不能继续运行快照后期待获得这些修复。没有新增平台桥接、模型调用或归因类别。

## 根因与修复

| 问题 | 原因 | 最小修复 | 实测 |
| --- | --- | --- | --- |
| 全成功批次 CLI 崩溃 | 空列表创建的 DataFrame 没有列，访问 actionability 抛异常 | 显式定义输出列，空结果照常生成三个带表头 CSV、JSON 和 summary | 原 CLI 非零退出；修复后退出 0，failure_events=0 |
| 单个坏 JSON 使整批中断 | 逐行 json.loads 没有隔离；合法 JSON 非对象也会在 .get 崩溃 | 隔离这两类输入，继续后续有效记录，输出 input_errors.json | 原回归抛 JSONDecodeError/AttributeError；修复后有效失败仍输出，保留真实源文件/行号 |
| 任意后续工具非失败被当成恢复 | 原逻辑只判断任意后续 tool 结果没有失败信号 | 仅确认同一用户轮次内、同工具、同规范化参数、发生于失败之后的新调用，且结果有明确结构化成功信号；同时拒绝矛盾失败状态 | 原逻辑把无关天气成功、不同订单参数、下一用户轮次、普通 pending 文本算恢复；修复后均为未确认 |
| 失败记录被绑定到后续用户问题 | 第一轮遍历把 latest_user 更新到最后一个用户消息，第二轮所有失败共享它 | 保存每个消息位置对应的用户问题 | 新用户轮次回归同时检查原失败仍指向原任务 |

所有业务改动集中于本目录入口文件：`confirmed_retry`、`scan`、`main` 和固定输出列；`changes.patch` 是相对原件的完整差异。`test_attribution.py` 是 10 项新增回归，`run_regression.py` 固化命令、退出码、耗时、原件 SHA 和原 CPU 合成夹具重放结果。

## 可复现运行

在项目根目录 `agent-eval-project` 执行：

```powershell
$env:PYTHONIOENCODING='utf-8'
python local_checks/2026-11-08_round1/attribution/run_regression.py
```

需要本机 Python 和 pandas；本机已装，不需要 GPU、模型密钥、外部服务。脚本自身不调用网络。回归器会把子进程 TMP/TEMP 指到可写本目录，避免本机默认沙箱临时目录权限问题。

手动处理自己的数据：

```powershell
python local_checks/2026-11-08_round1/attribution/structured_jsonl_attribution.py --input-dir "输入目录" --output-dir "输出目录"
```

输入目录仍按原合同匹配 `part_*.jsonl`。回归器复用 `local_checks/2026-11-08_cpu_smoke/inputs` 中的四组合成数据，保留审计原件和原始结果。

## 真实结果与统计口径

- 同一组 10 项回归：原件 1 通过、6 断言失败、3 异常；修复版 10/10 通过。见 before.log、after.log。
- 四组 CLI 重放：4/4 通过。基本样例仍是 6 个有效输入 trace 行、5 个去重失败事件、4 个内部事件、1 个外部事件；无关工具成功不再标恢复。
- 1000 条合成短记录：1000 个有效 trace 行，750 个去重失败事件。不是生产性能或语义归因准确率测试。
- 全成功：退出 0、0 失败，三个 CSV 都保留列名。
- 混合坏行：退出 0、invalid_lines=1、input_complete=false；坏行在 input_errors.json 有文件名与真实行号，不能将该批描述为完整分析通过。
- 每次执行的真实耗时、命令、summary 在 results.json；分类明细、summary、坏行清单在 outputs/。
- input_traces 表示有效 JSON 对象行数，重复导出的 trace 行会分别计数；不表示独立任务数。input_lines 包含空行和非法行，blank_lines 单列。
- raw_failure_events 表示规则识别到的工具失败和满足 Provider 契约的错误出现次数，duplicate_failure_events 表示去重掉的出现次数。failure_events 按原 session+call/error 合同去重，failure_topics 为有失败的 session/topic 数；均不等于所有用户任务数。

## 保留的边界

`recovered=true` 仅表示有“同工具同参数重试成功”的证据，输出 recovery_tool_call_id 可回查，recovery_scope 明确限定范围；不证明整个用户任务完成。更换参数后的正确重试、缺少明确成功状态、跨 trace 重试都保守保持未确认，未确认也不等于永久失败。旧 badcase_kind 字段保留兼容，阅读时必须结合这些定义。

本轮没有设计目标语义关联算法，没有评估真实标注集上的归因准确率，没有接平台、LLM 或 Benchmark。原消息结构合同、缺失身份的去重歧义、重复 call id、损坏/异常的深层消息结构、跨 trace 恢复与会话级完成证明不在本轮已验证能力内。不要把这些合成回归当成所有归因脚本或所有真实数据都通过。
