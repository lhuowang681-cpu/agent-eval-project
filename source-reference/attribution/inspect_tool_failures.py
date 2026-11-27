import pandas as pd,json,re
p=r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx";tid="tpc_ko3VK8a6JpMj"
r=pd.read_excel(p,sheet_name="RAW_NODES");e=pd.read_excel(p,sheet_name="ERROR_EVENTS")
g=r[r.effective_trace_id.eq(tid)].sort_values("created_at").drop_duplicates("id",keep="last");first=e[e.effective_trace_id.eq(tid)].sort_values("created_at").iloc[0]
b=g[(g.created_at<first.created_at)&g.role.eq("tool")].copy();rows=[]
for _,x in b.iterrows():
 s="" if pd.isna(x.content) else str(x.content)
 hit=bool(re.search(r"success[^a-zA-Z]*false|failed|ERROR_STATE|timeout",s,re.I))
 if not hit:continue
 try:d=json.loads(s)
 except:d={}
 data=d.get("data") if isinstance(d.get("data"),dict) else {}
 structured=(d.get("success") is False) or str(d.get("status","")).upper() in {"FAILED","ERROR"} or str(data.get("currentStatus","")).upper() in {"FAILED","ERROR_STATE"}
 rows.append({"time":str(x.created_at),"id":x.id,"structured_failure":structured,"top_success":d.get("success"),"currentStatus":data.get("currentStatus"),"msg":str(d.get("msg",""))[:300],"preview":s[:300]})
open("output/real_analysis/compact_deliverables/tool_failure_check.json","w",encoding="utf-8").write(json.dumps(rows,ensure_ascii=False,indent=2))
print(json.dumps({"keyword_hits":len(rows),"structured_failures":sum(x["structured_failure"] for x in rows)},ensure_ascii=True))
