"""Append lossless Trace evidence to the 3-case review workbook.
No text truncation. Values exceeding Excel's cell limit are split into ordered chunks.
"""
from pathlib import Path
import hashlib, json, math, shutil
import pandas as pd
from openpyxl import load_workbook
from openpyxl.styles import Font, PatternFill, Alignment
from openpyxl.utils import get_column_letter

SRC=Path(r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx")
BASE=Path("output/review_samples")
SOURCE_BOOK=BASE/"three_case_review_samples_with_evidence.xlsx"
OUTPUT_BOOK=BASE/"three_case_review_samples_lossless.xlsx"
TRACE_IDS=["tpc_A6iVTYMRUrW0","tpc_xRRBwNDCOUVp","tpc_2uc7jGBkl5ux"]
CHUNK=28000  # safely below Excel's 32767-char cell limit
BLUE="1F4E78"; WHITE="FFFFFF"

def text(v):
    if v is None or (isinstance(v,float) and pd.isna(v)): return ""
    if isinstance(v,(dict,list)): return json.dumps(v,ensure_ascii=False,default=str)
    return str(v)

def chunks(v):
    s=text(v)
    if not s:return [""]
    return [s[i:i+CHUNK] for i in range(0,len(s),CHUNK)]

def sha(v):return hashlib.sha256(text(v).encode("utf-8")).hexdigest()

def add_lossless_sheet(wb,name,df,key_cols,content_cols):
    if name in wb.sheetnames:del wb[name]
    ws=wb.create_sheet(name)
    headers=key_cols+["field_name","part_no","part_count","original_chars","sha256","full_value_part"]
    ws.append(headers)
    for c in ws[1]:c.fill=PatternFill("solid",fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
    for _,r in df.iterrows():
        keys=[text(r.get(k)) for k in key_cols]
        for field in content_cols:
            full=text(r.get(field)); parts=chunks(full); digest=sha(full)
            for no,part in enumerate(parts,1):
                ws.append(keys+[field,no,len(parts),len(full),digest,part])
    ws.freeze_panes="A2";ws.auto_filter.ref=ws.dimensions;ws.sheet_view.zoomScale=75
    for col in range(1,len(headers)+1):
        ws.column_dimensions[get_column_letter(col)].width=22 if col<len(headers) else 90
    for row in ws.iter_rows(min_row=2):
        for c in row:c.alignment=Alignment(vertical="top",wrap_text=True)
    return ws

shutil.copy2(SOURCE_BOOK,OUTPUT_BOOK)
wb=load_workbook(OUTPUT_BOOK)
raw=pd.read_excel(SRC,sheet_name="RAW_NODES",dtype=object)
ev=pd.read_excel(SRC,sheet_name="ERROR_EVENTS",dtype=object)
raw=raw[raw.effective_trace_id.isin(TRACE_IDS)].sort_values(["effective_trace_id","created_at","id"])
ev=ev[ev.effective_trace_id.isin(TRACE_IDS)].sort_values(["effective_trace_id","created_at","id"])
# Preserve every source column by serializing each field separately. IDs and key fields stay convenient for lookup.
raw_keys=["effective_trace_id","topic_id","id","parent_id","created_at","role","is_error"]
raw_content=[c for c in raw.columns if c not in raw_keys]
ev_keys=["effective_trace_id","id","parent_id","created_at","role","error_type"]
ev_content=[c for c in ev.columns if c not in ev_keys]
add_lossless_sheet(wb,"FULL_TRACE_NODES",raw,raw_keys,raw_content)
add_lossless_sheet(wb,"FULL_ERROR_EVENTS",ev,ev_keys,ev_content)
# Manifest: proves no source rows/fields were omitted and explains reassembly.
if "LOSSLESS_MANIFEST" in wb.sheetnames:del wb["LOSSLESS_MANIFEST"]
ws=wb.create_sheet("LOSSLESS_MANIFEST",0)
ws.append(["item","value"])
items=[
 ("说明","完整证据不截断；超过单元格上限的字段按 part_no 顺序拆分，拼接 full_value_part 可恢复原文"),
 ("分片字符数",CHUNK),("Trace 数",len(TRACE_IDS)),("RAW_NODES 原始行数",len(raw)),("ERROR_EVENTS 原始行数",len(ev)),
 ("RAW_NODES 原始字段数",len(raw.columns)),("ERROR_EVENTS 原始字段数",len(ev.columns)),
 ("Trace IDs",json.dumps(TRACE_IDS,ensure_ascii=False)),
 ("校验方法","按同一节点、同一 field_name 的 part_no 升序拼接 full_value_part，再计算 SHA-256，应与 sha256 列一致")]
for x in items:ws.append(x)
for c in ws[1]:c.fill=PatternFill("solid",fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
ws.column_dimensions["A"].width=28;ws.column_dimensions["B"].width=110
for row in ws.iter_rows():
    for c in row:c.alignment=Alignment(vertical="top",wrap_text=True)
# Ensure workbook scrollbars.
wb.views[0].showVerticalScroll=True;wb.views[0].showHorizontalScroll=True
wb.save(OUTPUT_BOOK)
print(json.dumps({"output":str(OUTPUT_BOOK),"trace_ids":TRACE_IDS,"raw_nodes":len(raw),"error_events":len(ev),"raw_lossless_rows":wb["FULL_TRACE_NODES"].max_row-1,"event_lossless_rows":wb["FULL_ERROR_EVENTS"].max_row-1},ensure_ascii=False,indent=2))
