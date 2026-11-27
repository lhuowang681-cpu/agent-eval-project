"""生成 Builtin 工具 × 细粒度报错类别 × 出错频次 Excel。

输入必须是 structured_jsonl_attribution.py 生成的 classified_all.csv。
统计对象仅限 tool_source=builtin 的真实结构化失败事件。
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

import pandas as pd
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


def classify_builtin_error(value: object) -> str:
    """基于真实 Tool Result 的 signal 做确定性细分类；不能确认时保留明确兜底。"""
    raw = str(value or "")
    low = raw.lower()
    rules = [
        ("设备离线", r"device_offline|device offline"),
        ("文件导出/下载失败", r"download failed|export failed"),
        ("后台Shell任务不存在", r"shell id .* not found"),
        ("权限或鉴权失败", r"permission_denied|permission denied|forbidden|unauthorized|access denied|lacks permission|not authorized"),
        ("高风险操作缺少确认", r"confirmation_required|requires confirmation|add --yes to confirm"),
        ("必填参数或字段缺失", r"keyword mode requires|missing required|required field|provide a value of type|required parameter|需要 --job-id|is required|specify at least one"),
        ("命令、参数或目标类型不符合工具契约", r"unknown (?:subcommand|flag|option|command|skill)|no such command|too many arguments|expected \d+ arguments|unexpected argument|unrecognized arguments|unsupported document type|not base|positional arguments are not supported|invalid output path|--output must be|unrecognized key\(s\)|invalid_argument"),
        ("外部API请求字段或取值非法", r"request validation failed|allowed discriminator|existing option value|invalid parameter|invalid value|bad request|validation failed|not_found|code.?800010701|code.?800030005"),
        ("文件或目录不存在", r"no such file or directory|cannot stat|cannot access|filenotfounderror|source file not found|path does not exist|enoent"),
        ("Python模块或运行依赖缺失", r"modulenotfounderror|no module named|importerror|package .* not found|command not found"),
        ("代码或命令语法错误", r"syntaxerror|parse error|syntax error|unterminated|invalid syntax|unexpected eof"),
        ("数据解析或文件格式错误", r"parsererror|unicodedecodeerror|decode error|error tokenizing|invalid json|jsondecodeerror|badzipfile|emptydataerror|excel file format"),
        ("数据处理运行异常", r"keyerror|valueerror|typeerror|indexerror|attributeerror|zerodivisionerror|nameerror|shape mismatch|broadcast|same shape|length mismatch"),
        ("网络或服务连接失败", r"connectionerror|connection refused|network is unreachable|temporary failure|service unavailable|bad gateway|http error|sslerror"),
        ("任务执行超时", r"timed out|timeout|time limit exceeded"),
        ("资源不足或进程终止", r"out of memory|memoryerror|killed|signal 9|resource exhausted|no space left"),
        ("业务对象或页面未找到", r"未找到|tab not found|not found in cdp chrome"),
        ("外部API方法限流或不可用", r"limited|rate limit|too many requests|method.*limited"),
        ("包安装或依赖构建失败", r"failed building wheel|could not build wheels|subprocess-exited-with-error|error: failed building"),
        ("命令执行失败但无错误详情", r'^success=false \| \{"exitcode":\d+,"output":"","stderr":"","stdout":"","success":false\}$|\[1\]\.ok=false \| none'),
    ]
    for category, pattern in rules:
        if re.search(pattern, low, re.I):
            return category
    # 原始证据已乱码时不臆测原因，只保留可核对的非零退出事实。
    if "nonzero exit code" in low and "����" in raw:
        return "CLI非零退出（原始错误文本编码损坏）"
    return "其他明确执行失败"


def _style_workbook(writer: pd.ExcelWriter) -> None:
    for ws in writer.book.worksheets:
        ws.freeze_panes = "A2"
        ws.auto_filter.ref = ws.dimensions
        ws.sheet_view.showGridLines = False
        for cell in ws[1]:
            cell.fill = PatternFill("solid", fgColor="1F4E78")
            cell.font = Font(color="FFFFFF", bold=True)
            cell.alignment = Alignment(horizontal="center", vertical="center")
        for row in ws.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=True)
        for col in range(1, ws.max_column + 1):
            values = [str(ws.cell(r, col).value or "") for r in range(1, min(ws.max_row, 200) + 1)]
            ws.column_dimensions[get_column_letter(col)].width = min(100, max(12, max(map(len, values)) + 2))


def generate_report(classified_all: Path, output: Path) -> dict:
    data = pd.read_csv(classified_all, encoding="utf-8-sig")
    required = {"tool_source", "tool_name", "signal", "topic_id", "trace_id", "tool_call_id", "category", "category_zh"}
    missing = sorted(required - set(data.columns))
    if missing:
        raise ValueError(f"classified_all.csv 缺少字段: {missing}")

    builtin = data[data["tool_source"].astype(str).str.lower().eq("builtin")].copy()
    builtin["Builtin报错类别"] = builtin["signal"].map(classify_builtin_error)

    cross = (
        builtin.groupby(["tool_name", "Builtin报错类别"], dropna=False)
        .size().reset_index(name="出错频次")
        .rename(columns={"tool_name": "Builtin工具名"})
        .sort_values(["Builtin工具名", "出错频次", "Builtin报错类别"], ascending=[True, False, True])
    )
    category_summary = (
        builtin.groupby("Builtin报错类别")
        .agg(
            出错频次=("tool_name", "size"),
            涉及Builtin工具数=("tool_name", "nunique"),
            去重Topic数=("topic_id", "nunique"),
            去重Trace数=("trace_id", "nunique"),
        ).reset_index()
        .sort_values(["出错频次", "Builtin报错类别"], ascending=[False, True])
    )
    tool_summary = (
        builtin.groupby("tool_name")
        .agg(
            出错频次=("signal", "size"),
            报错类别数=("Builtin报错类别", "nunique"),
            去重Topic数=("topic_id", "nunique"),
            去重Trace数=("trace_id", "nunique"),
        ).reset_index().rename(columns={"tool_name": "Builtin工具名"})
        .sort_values(["出错频次", "Builtin工具名"], ascending=[False, True])
    )
    audit = builtin[["tool_name", "Builtin报错类别", "signal", "topic_id", "trace_id", "tool_call_id", "category", "category_zh"]].rename(columns={
        "tool_name": "Builtin工具名", "signal": "原始报错证据", "topic_id": "Topic ID",
        "trace_id": "Trace ID", "tool_call_id": "Tool Call ID", "category": "原粗分类编码", "category_zh": "原粗分类名称",
    })

    if int(cross["出错频次"].sum()) != len(builtin):
        raise AssertionError("工具×类别聚合总数与 Builtin 真实失败事件数不一致")

    output.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(output, engine="openpyxl") as writer:
        cross.to_excel(writer, index=False, sheet_name="工具×报错类别频次")
        category_summary.to_excel(writer, index=False, sheet_name="报错类别汇总")
        tool_summary.to_excel(writer, index=False, sheet_name="Builtin工具汇总")
        audit.to_excel(writer, index=False, sheet_name="明细审计")
        _style_workbook(writer)

    return {
        "output": str(output),
        "builtin_error_events": int(len(builtin)),
        "builtin_tools": int(builtin["tool_name"].nunique()),
        "fine_categories": int(builtin["Builtin报错类别"].nunique()),
        "cross_rows": int(len(cross)),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="生成 Builtin 工具细粒度报错类别频次 Excel")
    parser.add_argument("--classified-all", required=True, type=Path, help="structured_jsonl_attribution.py 输出的 classified_all.csv")
    parser.add_argument("--output", required=True, type=Path, help="输出 Excel 路径")
    args = parser.parse_args()
    result = generate_report(args.classified_all, args.output)
    print(result)


if __name__ == "__main__":
    main()
