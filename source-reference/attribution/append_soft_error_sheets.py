"""Append soft-error analysis as trailing worksheets of a hard-error report.
Hard and soft metrics remain statistically isolated.
"""
from __future__ import annotations
import argparse, shutil
from pathlib import Path
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.utils import get_column_letter

BLUE='1F4E78';WHITE='FFFFFF'

def append(hard_report,soft_report,output):
    hard=Path(hard_report);soft=Path(soft_report);out=Path(output)
    out.parent.mkdir(parents=True,exist_ok=True)
    if hard.resolve()!=out.resolve():shutil.copy2(hard,out)
    summary=pd.read_excel(soft,sheet_name='SOFT_ERROR_SUMMARY')
    details=pd.read_excel(soft,sheet_name='SOFT_ERROR_DETAILS')
    wb=load_workbook(out)
    for name in ['SOFT_ERROR_GUIDE','SOFT_ERROR_SUMMARY','SOFT_ERROR_DETAILS']:
        if name in wb.sheetnames:del wb[name]
    guide=wb.create_sheet('SOFT_ERROR_GUIDE')
    guide_rows=[
      ('统计区','软错误 Agent 改进指标'),
      ('与硬错误关系','独立统计；不计入硬错误数量、Top 5、百分比和正式 Badcase 分布'),
      ('软错误定义','节点调用真实失败，但同一 Trace 后续通过重试、替代工具或继续执行得到恢复/完成'),
      ('主要指标','软错误事件数、受影响 Trace 数、固定类别、责任模块、失败工具、替代路径、额外节点数'),
      ('分析用途','识别 Agent 工具选择、参数修正、Fallback、恢复效率和额外调用成本问题'),
    ]
    guide.append(['项目','说明'])
    for x in guide_rows:guide.append(x)
    sum_ws=wb.create_sheet('SOFT_ERROR_SUMMARY')
    sum_ws.append(list(summary.columns))
    for row in summary.itertuples(index=False,name=None):sum_ws.append(list(row))
    det_ws=wb.create_sheet('SOFT_ERROR_DETAILS')
    det_ws.append(list(details.columns))
    for row in details.itertuples(index=False,name=None):det_ws.append(list(row))
    for ws in [guide,sum_ws,det_ws]:
        ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions;ws.sheet_view.zoomScale=80
        for c in ws[1]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
        for row in ws.iter_rows():
            for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
        for col in ws.columns:
            vals=list(col);ws.column_dimensions[get_column_letter(vals[0].column)].width=min(55,max(12,max(len(str(x.value or '')) for x in vals[:500])+2))
    wb.views[0].showVerticalScroll=True;wb.views[0].showHorizontalScroll=True
    wb.save(out)
    return {'output':str(out),'soft_categories':len(summary),'soft_events':len(details),'soft_traces':details.trace_id.nunique()}

def main():
    p=argparse.ArgumentParser();p.add_argument('--hard-report',required=True);p.add_argument('--soft-report',required=True);p.add_argument('--output',required=True);a=p.parse_args();print(append(a.hard_report,a.soft_report,a.output))
if __name__=='__main__':main()
