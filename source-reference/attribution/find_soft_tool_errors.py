import json,re
from pathlib import Path
import pandas as pd
P=Path(r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx")
R=pd.read_excel(P,sheet_name="RAW_NODES").sort_values(["effective_trace_id","created_at"])
O=pd.read_csv("output/trace_outcome_audit.csv")

def parse(v):
 try:
  x=json.loads(v) if isinstance(v,str) else {}
  return x if isinstance(x,dict) else {}
 except:return {}
def failure(v):
 s="" if pd.isna(v) else str(v); d=parse(s); data=d.get("data") if isinstance(d.get("data"),dict) else {}
 structured=d.get("success") is False or str(d.get("status","")).upper() in {"FAILED","ERROR"} or str(data.get("currentStatus","")).upper() in {"FAILED","ERROR_STATE"}
 textual=bool(re.search(r"(?:request|execution|tool) failed|execution is disabled|unsupported document type|unable to extract document id",s,re.I)) and len(s)<8000
 return structured or textual
def success(v):
 s="" if pd.isna(v) else str(v);d=parse(s);data=d.get("data") if isinstance(d.get("data"),dict) else {}
 return d.get("success") is True or str(data.get("currentStatus","")).upper() in {"SUCCESS","FINISHED"} or "Command completed successfully" in s
rows=[]
for tid,g in R.groupby("effective_trace_id"):
 g=g.reset_index(drop=True); outcome=O.loc[O.trace_id.eq(tid),"outcome"]; outcome=outcome.iloc[0] if len(outcome) else ""
 for i,r in g[g.role.eq("tool")].iterrows():
  if not failure(r.content):continue
  later=g.iloc[i+1:]
  recovered=any(success(x) for x in later[later.role.eq("tool")].content) or any((later.role.eq("assistant")) & (~later.is_error.fillna(False).astype(bool)) & later.content.fillna("").str.strip().ne(""))
  if recovered:
   rows.append({"topic_id":next((str(x) for x in g.topic_id.dropna() if str(x).strip()),tid),"trace_id":tid,"trace_outcome":outcome,"failed_at":str(r.created_at),"failed_tool_node":r.id,"failure":str(r.content)[:1500],"later_successful_tool":any(success(x) for x in later[later.role.eq('tool')].content),"later_assistant_output":any((later.role.eq('assistant')) & (~later.is_error.fillna(False).astype(bool)) & later.content.fillna('').str.strip().ne(''))})
d=pd.DataFrame(rows);d.to_csv("output/recovered_soft_tool_errors.csv",index=False,encoding="utf-8-sig");print("cases",len(d),"traces",d.trace_id.nunique());print(d[["topic_id","trace_id","trace_outcome","failed_at","later_successful_tool","later_assistant_output"]].head(30).to_json(force_ascii=True,orient="records"))
