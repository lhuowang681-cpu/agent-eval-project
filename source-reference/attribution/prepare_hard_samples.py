import pandas as pd,json
p=r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx"
r=pd.read_excel(p,sheet_name="RAW_NODES");e=pd.read_excel(p,sheet_name="ERROR_EVENTS")
ids=["tpc_A6iVTYMRUrW0","tpc_xRRBwNDCOUVp","tpc_2uc7jGBkl5ux"];out=[]
for tid in ids:
 g=r[r.effective_trace_id.eq(tid)].sort_values("created_at").drop_duplicates("id",keep="last");eg=e[e.effective_trace_id.eq(tid)].sort_values("created_at")
 out.append({"trace_id":tid,"topic_ids":[str(x) for x in g.topic_id.dropna().unique()],"nodes":g[["created_at","role","is_error","id","parent_id","content","tools","error","model","provider"]].to_dict("records"),"errors":eg[["created_at","id","parent_id","error_type","error_message","error_raw","content","tools","model","provider"]].to_dict("records")})
open("output/sample3_full.json","w",encoding="utf-8").write(json.dumps(out,ensure_ascii=False,indent=2,default=str))
print([(x["trace_id"],x["topic_ids"],len(x["nodes"]),len(x["errors"])) for x in out])
