"""
badcase_analysis.py
主入口脚本 — 端到端运行完整流水线。

用法：
  python badcase_analysis.py                    # 完整流水线（从 Langfuse 拉取）
  python badcase_analysis.py --offline          # 离线模式（跳过 Langfuse，用缓存 JSON）
  python badcase_analysis.py --skip-classify    # 跳过 LLM 分类（用已有 classified_badcases.json）
  python badcase_analysis.py --days 14          # 拉取最近 14 天
  python badcase_analysis.py --limit 1000       # 最多拉取 1000 条
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime

from dotenv import load_dotenv

load_dotenv()

OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

RAW_PATH = f"{OUTPUT_DIR}/raw_badcases.json"
CLASSIFIED_PATH = f"{OUTPUT_DIR}/classified_badcases.json"


def run_pipeline(args: argparse.Namespace) -> None:
    start_t = time.time()
    print(f"\n{'='*60}")
    print(f"  TripYoYo Badcase 归因分析流水线")
    print(f"  启动时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'='*60}\n")

    # ── Step 1: 数据拉取 ──────────────────────────────────────────────────────────
    if args.offline or args.skip_classify:
        print("[Step 1] 离线模式 — 跳过 Langfuse 拉取，使用本地缓存")
        if not os.path.exists(RAW_PATH) and not args.skip_classify:
            print(f"  [Error] 找不到缓存文件: {RAW_PATH}")
            print("  请先运行一次联网模式，或手动放置 raw_badcases.json")
            sys.exit(1)
    else:
        print("[Step 1] 从 Langfuse 拉取 badcase traces...")
        from langfuse_fetcher import fetch_badcase_traces, save_to_json

        traces = fetch_badcase_traces(
            days=args.days,
            limit=args.limit,
            tags=args.tags.split(",") if args.tags else None,
        )
        if not traces:
            print("  [Warning] 未找到任何 badcase，流水线终止。")
            print("  提示：检查 Langfuse 连接配置，或放宽过滤条件（增大 --days）。")
            return
        save_to_json(traces, RAW_PATH)
        print(f"  ✓ 拉取 {len(traces)} 条 badcase，已缓存到 {RAW_PATH}")

    # ── Step 2: LLM 归因分类 ─────────────────────────────────────────────────────
    if args.skip_classify:
        print("\n[Step 2] 跳过 LLM 分类 — 使用已有分类结果")
        if not os.path.exists(CLASSIFIED_PATH):
            print(f"  [Error] 找不到分类结果文件: {CLASSIFIED_PATH}")
            sys.exit(1)
    else:
        print("\n[Step 2] LLM 归因分类（这可能需要几分钟）...")
        from llm_classifier import classify_batch, classify_single
        import json

        with open(RAW_PATH, encoding="utf-8") as f:
            traces = json.load(f)

        # 归因前 Trace 去噪：此结果是 LLM 的核心输入，不是仅用于展示。
        if args.source_xlsx:
            print("  正在重建父子链并生成归因专用去噪 Trace...")
            from trace_denoiser import enrich_traces_from_xlsx
            traces = enrich_traces_from_xlsx(traces, args.source_xlsx, max_nodes=args.attribution_trace_nodes)
            denoised_path = f"{OUTPUT_DIR}/denoised_traces.json"
            with open(denoised_path, "w", encoding="utf-8") as f:
                json.dump(traces, f, ensure_ascii=False, indent=2)
            print(f"  ✓ 去噪 Trace 已保存: {denoised_path}")

        print(f"  共 {len(traces)} 条 trace 待分类，模型: {os.getenv('LLM_MODEL', 'gpt-4o')}")

        results = classify_batch(traces, sleep_between=0.3)

        with open(CLASSIFIED_PATH, "w", encoding="utf-8") as f:
            json.dump(results, f, ensure_ascii=False, indent=2)

        unknown_cnt = sum(1 for r in results if r.get("module_id") == "UNKNOWN")
        print(f"  ✓ 分类完成，{len(results)} 条，UNKNOWN {unknown_cnt} 条")
        print(f"  结果已保存到 {CLASSIFIED_PATH}")

    # ── Step 3: 聚合统计 ─────────────────────────────────────────────────────────
    print("\n[Step 3] 聚合统计...")
    from aggregator import load_classified, aggregate, print_summary, save_csv

    df = load_classified(CLASSIFIED_PATH)
    df_cat, df_mod = aggregate(df)
    print_summary(df_cat, df_mod)
    save_csv(df_cat, df_mod, OUTPUT_DIR, source_df=df)

    # ── Step 4: 可视化图表 ───────────────────────────────────────────────────────
    print("\n[Step 4] 生成可视化图表...")
    from visualizer import chart1_error_category, chart2_module_distribution, chart3_layer_heatmap

    path1 = chart1_error_category(df_cat, top_n=args.top_n, output_path=f"{OUTPUT_DIR}/chart1_error_category.png")
    path2 = chart2_module_distribution(df_mod, top_n=args.top_n, output_path=f"{OUTPUT_DIR}/chart2_module_distribution.png")

    if args.heatmap:
        chart3_layer_heatmap(df_mod, output_path=f"{OUTPUT_DIR}/chart3_layer_heatmap.png")

    # ── Step 5: 最高频错误类别 Case 报告 ─────────────────────────────────────────
    case_report_path = ""
    if not args.skip_case_report:
        print("\n[Step 5] 生成最高频错误类别 Case Excel...")
        from high_frequency_case_report import build_report
        case_report_path = f"{OUTPUT_DIR}/high_frequency_error_case_report.xlsx"
        case_result = build_report(
            CLASSIFIED_PATH,
            args.source_xlsx or None,
            case_report_path,
            case_count=args.case_count,
            max_trace_nodes=args.max_trace_nodes,
        )
        print(f"  ✓ {case_result['top_category_zh']}: {case_result['top_count']} 个 Trace ({case_result['top_share_pct']}%)")
        print(f"  ✓ 归因: {case_result['layer_id']} / {case_result['module_id']} {case_result['module_name']}")
        print(f"  ✓ Case Excel: {case_report_path}")

    # ── 完成摘要 ─────────────────────────────────────────────────────────────────
    elapsed = time.time() - start_t
    total_badcases = df_cat["count"].sum()

    print(f"\n{'='*60}")
    print(f"  ✅  流水线完成！耗时 {elapsed:.1f}s")
    print(f"{'='*60}")
    print(f"\n  📊  分析结果摘要")
    print(f"  ├─ 总 badcase 数:    {total_badcases}")
    print(f"  ├─ 错误类别数:       {len(df_cat)}")
    print(f"  ├─ 涉及模块数:       {len(df_mod)}")

    # Top 3 错误类别
    top3_cat = df_cat.head(3)
    print(f"\n  🔥  Top 3 错误类别:")
    for _, row in top3_cat.iterrows():
        print(f"     {row['error_category_zh']} ({row['error_category']}): {row['count']} 次 ({row['pct']}%)")

    # Top 3 模块
    top3_mod = df_mod.sort_values("count", ascending=False).head(3)
    print(f"\n  🔥  Top 3 高频出错模块:")
    for _, row in top3_mod.iterrows():
        print(f"     {row['module_id']} {row['module_name']}: {row['count']} 次 ({row['pct']}%)")

    print(f"\n  📁  输出文件:")
    print(f"     {path1}")
    print(f"     {path2}")
    print(f"     {OUTPUT_DIR}/stat_error_category.csv")
    print(f"     {OUTPUT_DIR}/stat_module_distribution.csv")
    if case_report_path:
        print(f"     {case_report_path}")
    print()


def main():
    parser = argparse.ArgumentParser(
        description="TripYoYo Langfuse Badcase 归因分析",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例：
  python badcase_analysis.py
  python badcase_analysis.py --days 14 --limit 1000
  python badcase_analysis.py --offline --skip-classify   # 纯图表重绘
  python badcase_analysis.py --heatmap                   # 额外生成热力图
        """,
    )
    parser.add_argument("--days", type=int, default=int(os.getenv("ANALYSIS_DAYS", "7")), help="拉取最近 N 天数据")
    parser.add_argument("--limit", type=int, default=int(os.getenv("ANALYSIS_LIMIT", "500")), help="最大拉取条数")
    parser.add_argument("--tags", type=str, default="", help="按 Langfuse tags 过滤（逗号分隔）")
    parser.add_argument("--top-n", type=int, default=25, dest="top_n", help="图表展示 Top N 个")
    parser.add_argument("--offline", action="store_true", help="离线模式：跳过 Langfuse 拉取")
    parser.add_argument("--skip-classify", action="store_true", dest="skip_classify",
                        help="跳过 LLM 分类（使用已有 classified_badcases.json）")
    parser.add_argument("--heatmap", action="store_true", help="额外生成层级热力图（图表③）")
    parser.add_argument("--source-xlsx", type=str, default="", help="可选：含 RAW_NODES/ERROR_EVENTS/TRACE_MANIFEST 的源 Excel，用于 Case 详情与 Trace 去噪")
    parser.add_argument("--case-count", type=int, default=5, help="最高频类别代表 Case 数")
    parser.add_argument("--max-trace-nodes", type=int, default=12, help="Excel 中每个代表 Case 最多展示的去噪 Trace 节点")
    parser.add_argument("--attribution-trace-nodes", type=int, default=40, help="LLM 归因输入中每个 Trace 最多保留的因果节点")
    parser.add_argument("--skip-case-report", action="store_true", help="跳过最高频错误类别 Case Excel")

    args = parser.parse_args()
    run_pipeline(args)


if __name__ == "__main__":
    main()
