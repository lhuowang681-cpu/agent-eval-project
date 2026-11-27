# Langfuse Agent Badcase 智能归因 Skill 交付说明

## 交付目标

本 Skill 用于从 Langfuse Trace 中识别 **能够通过修改 Agent 编排源码解决或显著缓解的问题**，并生成面向开发人员的模块归因、Top 问题与代表 Case 报表。

本 Skill 不把所有 MCP、Tool、Provider 或外部服务错误直接算作 Agent 源码问题。默认执行“外部直接故障与 Agent 内部处理缺陷拆分”，只有通过内部源码可改进性门禁的问题进入开发榜。

## 核心原则

1. 固定使用 `taxonomy.py` 的 8 层 56 模块作为一级类别；
2. 具体错误机制作为二级类别；
3. 找最早内部异常节点，不把最后报错节点当根因；
4. Tool/MCP/Provider Error 默认只是报错暴露位置；
5. 外部问题先硬分流，而不是只降低数值权重；
6. L2.2 不作为兜底桶，优先检查 L2.5、L3、L4、L5、L7 等具体模块；
7. 模块多样性来自真实因果证据，不人为凑类别；
8. 无内部证据时明确“不进入开发榜”。

## 日报模板要求

最终对人交付的日报必须参考用户验收模板 `tripyoyo报错2026.07.30.xlsx` 的整体结构：17 张固定 Sheet、00_CHARTS 四图、SAMPLE_OVERVIEW 10 列、每个 Case 的九段式主表与 CASE/RULES/TRACE_AUDIT 三联结构。Skill 决定报告内容和排序，模板决定工作簿结构与视觉样式。

推荐渲染命令：

```bash
python render_daily_report_template.py --template <日报模板.xlsx> --root <项目根目录> --classified-internal <internal.csv> --classified-external <external.csv> --output <日报.xlsx>
```

## 结构化 JSONL 推荐入口

```bash
python structured_jsonl_attribution.py --input-dir <jsonl分片目录> --output-dir <分类输出目录>
python prepare_structured_daily.py --input-dir <jsonl分片目录> --classified-internal <分类输出目录/classified_internal.csv> --output-dir <日报准备目录>
python render_daily_report_template.py --template <日报模板.xlsx> --root <日报准备目录> --classified-internal <分类输出目录/classified_internal.csv> --classified-external <分类输出目录/classified_external.csv> --traces representative_traces.jsonl --output <最终日报.xlsx>
python builtin_tool_error_category_report.py --classified-all <分类输出目录/classified_all.csv> --output <交付目录/builtin_tool_error_category_statistics.xlsx>
```

此入口只扫描真实结构化失败；MCP/Plugin/Unknown 工具来源统一按外部原因分流，只有 Builtin 工具和符合证据契约的 Provider/Runtime 错误可进入开发榜。

## 固定正式交付物

结构化 JSONL 单轮分析完成后，至少交付以下两个 Excel：

1. **Agent 源码开发日报**：沿用验收模板，固定为 `00_CHARTS、SAMPLE_OVERVIEW、CASE_01～CASE_05` 及各 Case 的 RULES/TRACE_AUDIT；
2. **Builtin 工具报错类别频次表**：`builtin_tool_error_category_statistics.xlsx`，按 `Builtin工具名 × 细粒度报错类别 × 出错频次` 统计。

Builtin 统计表固定含四张 Sheet：

- `工具×报错类别频次`；
- `报错类别汇总`；
- `Builtin工具汇总`；
- `明细审计`。

主频次按真实失败 Tool Call 事件统计；辅助输出去重 Topic 数和去重 Trace 数。细分类只依据原始 Langfuse Tool Result 证据，不依据 Skill 中间产物，不对乱码或缺失错误正文做主观根因猜测。

## 推荐入口

对于 Langfuse 导出 Excel：

```bash
python reconstruct_langfuse_export.py
python scan_specific_errors.py
python scan_new_export_precise.py --input specific_error_scan.json
python refine_new_export_categories.py --input new_export_precise_classified.json
python generate_new_export_deliverable_v2.py
```

对于包含 `RAW_NODES` 的离线工作簿：

```bash
python trace_denoiser.py --input ./output/raw_badcases.json --source-xlsx <source.xlsx> --output ./output/denoised_traces.json
python llm_classifier.py --input ./output/denoised_traces.json --output ./output/classified_badcases.json
```

## 必须先看

- `SKILL.md`：总工作流与硬规则；
- `developer_source_attribution_spec.md`：Agent 源码归因、开发榜门禁和外部问题分流规范；
- `taxonomy.py`：8 层 56 模块唯一事实源；
- `references_reporting_spec.md`：人工验收和报告展示规范。

## 输出泳道

- Agent 源码问题榜：有内部异常节点、代码模块、反事实修复和证据；
- 外部依赖：MCP、Tool、Provider、网关、数据库或第三方服务自身故障；
- 用户/业务输入：用户明确指定的错误工具、表名、参数或前提；
- 非代码配置：权限、凭证、Quota、套餐和环境开通；
- 归因治理：Trace、Span、Parent Link、Error Body 或输入来源缺失；
- 潜在改进机会：可能存在 Agent 改进空间，但证据未达到开发榜门槛。

## 交接验收

交付前执行：

```bash
python taxonomy.py
python -m py_compile scan_new_export_precise.py refine_new_export_categories.py langfuse_trace_recoverer.py generate_new_export_deliverable_v2.py llm_classifier.py trace_denoiser.py
```

报告验收至少检查：

- 开发 Top 5 中是否混入纯外部故障；
- 每个 Case 是否有内部证据节点和反事实修复；
- 一级类别是否来自 8 层 56 模块；
- L2.2 是否存在明显兜底归因；
- Tool/MCP 错误是否分析参数来源和输入有效性；
- 无证据问题是否进入归因治理而非强归 L6/L2.2；
- 表格中的错误输出是否已转写为人类可读摘要。
