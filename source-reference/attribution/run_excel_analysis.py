"""Unified entry point for the finalized Excel badcase workflow.

Outputs (under <output-dir>/compact_deliverables):
1. 01_top5_badcase.png
2. 02_module_distribution_pie.png
3. 03_top_error_single_case.xlsx

Current evaluation scope: hard errors only.
"""
from __future__ import annotations
import argparse, os, shutil, subprocess, sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent

def run(script, env):
    cmd=[sys.executable,str(ROOT/script)]
    print(f"[run] {script}")
    subprocess.run(cmd,cwd=ROOT,env=env,check=True)

def main():
    p=argparse.ArgumentParser(description="TripYoYo Agent Badcase 固定交付流水线")
    p.add_argument("--source-xlsx",required=True,help="含 ERROR_EVENTS/RAW_NODES/TRACE_MANIFEST 的源 Excel")
    p.add_argument("--output-dir",default="./output/analysis",help="分析输出目录")
    args=p.parse_args()
    source=Path(args.source_xlsx).resolve()
    if not source.exists(): raise FileNotFoundError(source)
    out=Path(args.output_dir)
    if not out.is_absolute(): out=(ROOT/out).resolve()
    out.mkdir(parents=True,exist_ok=True)
    env=os.environ.copy();env["SOURCE_XLSX"]=str(source);env["ANALYSIS_OUTPUT_DIR"]=str(out)
    run("analyze_excel_badcases.py",env)
    # Soft errors are Agent improvement indicators and are exported separately;
    # they never enter formal hard-Badcase counts or percentages.
    subprocess.run([sys.executable,str(ROOT/"soft_error_analyzer.py"),"--source-xlsx",str(source),"--output-dir",str(out/"soft_errors")],cwd=ROOT,env=env,check=True)
    run("generate_compact_deliverables.py",env)
    run("redraw_module_pie.py",env)
    run("generate_native_horizontal_excel.py",env)
    compact=out/"compact_deliverables"
    src=compact/"03_top_error_single_case_hard_errors_only.xlsx"
    final=compact/"03_top_error_single_case.xlsx"
    if not src.exists(): raise FileNotFoundError(src)
    shutil.copy2(src,final)
    expected=[compact/"01_top5_badcase.png",compact/"02_module_distribution_pie.png",final,out/"soft_errors"/"soft_error_observations.xlsx"]
    missing=[str(x) for x in expected if not x.exists()]
    if missing: raise RuntimeError(f"交付物缺失: {missing}")
    print("\n[done]")
    for x in expected: print(x)

if __name__=="__main__":main()
