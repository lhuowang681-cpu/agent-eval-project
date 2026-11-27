"""Detect recoverable Agent soft errors and export separate improvement metrics.

Soft errors never enter formal hard-Badcase counts. A candidate must show a real
failed call and subsequent continuation/recovery evidence in the same Trace.
"""
from __future__ import annotations
import argparse,json,re
from pathlib import Path
import pandas as pd
from openpyxl.styles import Font,PatternFill,Alignment

FIXED_CATEGORIES={
 "tool_unavailable":("工具不可用","L6.2","BuiltinToolsExecutor"),
 "tool_timeout":("工具执行超时","L6.1","ToolExecutionService"),
 "tool_validation_error":("工具参数/类型校验失败","L6.1","ToolExecutionService"),
 "tool_auth_error":("工具授权失败","L6.3","MCP Service"),
 "tool_execution_failed":("工具执行失败","L6.1","ToolExecutionService"),
 "model_request_recovered":("模型请求失败后恢复","L5.3","Provider Factory"),
}

def parse(v):
 try:
  x=json.loads(v) if isinstance(v,str) else {}
  return x if isinstance(x,dict) else {}
 except:return {}
def parse_any(v):
 try:return json.loads(v) if isinstance(v,str) else v
 except:return {}
def text(v):return "" if v is None or (isinstance(v,float) and pd.isna(v)) else str(v)
def tool_call(v):
 x=parse_any(v)
 if isinstance(x,list):x=x[0] if x else {}
 if not isinstance(x,dict):return {}
 return {"identifier":x.get("identifier") or "","api":x.get("apiName") or x.get("name") or "","input":text(x.get("arguments") or x.get("args"))}
def actual_tool_failure(v):
 s=text(v).strip();d=parse(s);data=d.get("data") if isinstance(d.get("data"),dict) else {}
 structured=d.get("success") is False or str(d.get("status","")).upper() in {"FAILED","ERROR"} or str(data.get("currentStatus","")).upper() in {"FAILED","ERROR_STATE"} or bool(d.get("error"))
 explicit=bool(re.search(r"(?:request|execution|tool) failed|execution is disabled|unsupported document type|unable to extract document id|grant token has expired|permission denied",s,re.I)) and len(s)<12000
 return structured or explicit
def actual_success(v):
 s=text(v);d=parse(s);data=d.get("data") if isinstance(d.get("data"),dict) else {}
 return d.get("success") is True or str(data.get("currentStatus","")).upper() in {"SUCCESS","FINISHED"} or "Command completed successfully" in s
def classify(s):
 low=s.lower()
 if "disabled" in low or "unavailable" in low:return "tool_unavailable"
 if "timeout" in low or "timed out" in low:return "tool_timeout"
 if "grant token has expired" in low or "permission denied" in low or "unauthorized" in low:return "tool_auth_error"
 if "validation" in low or "unsupported document type" in low or "unable to extract" in low:return "tool_validation_error"
 return "tool_execution_failed"

def analyze(source,output_dir):
 out=Path(output_dir);out.mkdir(parents=True,exist_ok=True)
 raw=pd.read_excel(source,sheet_name="RAW_NODES").sort_values(["effective_trace_id","created_at"]).drop_duplicates("id",keep="last")
 observations=[]
 for tid,g0 in raw.groupby("effective_trace_id",sort=False):
  g=g0.reset_index(drop=True);topic=next((text(x) for x in g.topic_id.dropna() if text(x).strip()),text(tid))
  for i,n in g[g.role.eq("tool")].iterrows():
   if not actual_tool_failure(n.content):continue
   parent=g[g.id.astype(str).eq(text(n.parent_id))]
   caller=parent.iloc[-1] if len(parent) else None;call=tool_call(caller.tools) if caller is not None else {}
   later=g.iloc[i+1:];later_tools=later[later.role.eq("tool")]
   success_tool=later_tools[later_tools.content.map(actual_success)]
   success_answer=later[(later.role.eq("assistant"))&(~later.is_error.fillna(False).astype(bool))&later.content.fillna("").astype(str).str.strip().ne("")]
   if success_tool.empty and success_answer.empty:continue
   category=classify(text(n.content));zh,mid,mname=FIXED_CATEGORIES[category]
   recovered_by="后续工具成功" if len(success_tool) else "后续模型输出"
   replacement=""
   if len(success_tool):
    sn=success_tool.iloc[0];sp=g[g.id.astype(str).eq(text(sn.parent_id))];sc=tool_call(sp.iloc[-1].tools) if len(sp) else {};replacement=f"{sc.get('identifier','')}/{sc.get('api','')}"
   observations.append({"topic_id":topic,"trace_id":tid,"soft_error_category":category,"soft_error_category_zh":zh,"layer_id":mid.split('.')[0],"module_id":mid,"module_name":mname,"failed_at":n.created_at,"failed_tool":f"{call.get('identifier','')}/{call.get('api','')}","tool_input":call.get('input',''),"failure_output":text(n.content),"recovered_by":recovered_by,"replacement_tool":replacement,"extra_nodes_after_failure":len(later),"formal_badcase_count":"不计入"})
 detail=pd.DataFrame(observations)
 if detail.empty:
  detail=pd.DataFrame(columns=["topic_id","trace_id","soft_error_category","soft_error_category_zh","layer_id","module_id","module_name","failed_at","failed_tool","tool_input","failure_output","recovered_by","replacement_tool","extra_nodes_after_failure","formal_badcase_count"])
 summary=(detail.groupby(["soft_error_category","soft_error_category_zh","layer_id","module_id","module_name"],dropna=False).agg(soft_error_events=("trace_id","size"),affected_traces=("trace_id","nunique"),avg_extra_nodes=("extra_nodes_after_failure","mean")).reset_index().sort_values("affected_traces",ascending=False)) if len(detail) else pd.DataFrame()
 if len(summary):summary["avg_extra_nodes"]=summary.avg_extra_nodes.round(1)
 detail.to_csv(out/"soft_error_details.csv",index=False,encoding="utf-8-sig");summary.to_csv(out/"soft_error_summary.csv",index=False,encoding="utf-8-sig")
 xlsx=out/"soft_error_observations.xlsx"
 with pd.ExcelWriter(xlsx,engine="openpyxl") as w:
  summary.to_excel(w,sheet_name="SOFT_ERROR_SUMMARY",index=False);detail.to_excel(w,sheet_name="SOFT_ERROR_DETAILS",index=False)
 wb=__import__("openpyxl").load_workbook(xlsx);fill=PatternFill("solid",fgColor="1F4E78")
 for ws in wb.worksheets:
  ws.freeze_panes="A2";ws.auto_filter.ref=ws.dimensions
  for c in ws[1]:c.fill=fill;c.font=Font(color="FFFFFF",bold=True)
  for row in ws.iter_rows():
   for c in row:c.alignment=Alignment(vertical="top",wrap_text=True)
 wb.save(xlsx)
 return {"events":len(detail),"affected_traces":detail.trace_id.nunique() if len(detail) else 0,"categories":len(summary),"excel":str(xlsx)}
def main():
 p=argparse.ArgumentParser();p.add_argument("--source-xlsx",required=True);p.add_argument("--output-dir",default="./output/soft_errors");a=p.parse_args();print(json.dumps(analyze(a.source_xlsx,a.output_dir),ensure_ascii=False,indent=2))
if __name__=="__main__":main()
