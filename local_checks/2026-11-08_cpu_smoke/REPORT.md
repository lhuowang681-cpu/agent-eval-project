# 本机CPU离线实测

日期：2026-11-08。只使用合成记录；运行原始JSONL CLI和已检查的纯处理模块，未修改参考源码。

环境：{'os': 'Windows-11-10.0.26200-SP0', 'python': '3.13.9', 'logicalCPUs': 16, 'ramGiB': 31.7}。执行路径无需GPU；不代表已验证本地大模型推理。

## 实测通过

- basic：通过，耗时0.841秒（含子进程启动）

- batch_1000：通过，耗时1.052秒（含子进程启动）

- original_denoiser：通过

- original_convergence_and_medoid：通过

- original_aggregation_and_charts：通过

## 实际复现的局限

- unrelated_tool_success_mislabels_recovery：Order failure followed by weather success is marked recovered=True.

- empty_failure_result_crashes_cli：All-success input causes KeyError: actionability when main accesses missing DataFrame columns.

- bad_json_line_aborts_batch：Malformed line raises JSONDecodeError; no per-line quarantine.

## 未验证范围

- full Agent web platform (no full app/build manifests or dependencies in selected reference package)

- configuration to live Agent to evaluation integrated product

- real LLM classification; openai/langfuse packages absent

- PostgreSQL/Redis/remote tools

- local LLM inference and any GPU performance

## 如何重复

在项目根运行：`python -B local_checks/2026-11-08_cpu_smoke/run_check.py`。此脚本阻止socket连接，子进程不传入模型凭据。输出覆盖本文件夹的合成测试产物，不访问用户数据。

报告文件为RESULTS.json，CLI标准输出与错误在outputs各场景目录，图表在outputs/reports。分类结果由旧启发式产生，不是人工确认根因或准确率。原始96文件hash检查前后一致。
