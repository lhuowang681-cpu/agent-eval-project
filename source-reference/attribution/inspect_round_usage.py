import json
import pandas as pd
p=r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx"
d=pd.read_excel(p,sheet_name="RAW_NODES",usecols=["effective_trace_id","id","parent_id","role","model","provider","created_at","metadata"])
fields=["totalInputTokens","totalOutputTokens","totalTokens","inputCachedTokens","inputCacheMissTokens","inputWriteCacheTokens","cost","ttft","latency"]
rows=[]
for _,r in d.iterrows():
    try: m=json.loads(r.metadata) if isinstance(r.metadata,str) else {}
    except Exception: m={}
    if any(k in m for k in fields):
        rows.append({**{k:r[k] for k in ["effective_trace_id","id","parent_id","role","model","provider","created_at"]},**{k:m.get(k) for k in fields}})
u=pd.DataFrame(rows)
print("raw_nodes",len(d))
print("usage_nodes",len(u))
print("usage_traces",u.effective_trace_id.nunique())
print("by_role",u.role.value_counts(dropna=False).to_dict())
print("assistant_nodes",int((d.role=="assistant").sum()))
print("assistant_with_usage",int((u.role=="assistant").sum()))
print("missing_totalInputTokens",int(u.totalInputTokens.isna().sum()))
print("missing_totalOutputTokens",int(u.totalOutputTokens.isna().sum()))
print("duplicate_node_ids",int(u.id.duplicated().sum()))
print("time_min",u.created_at.min(),"time_max",u.created_at.max())
u.to_csv("output/real_analysis/round_token_usage.csv",index=False,encoding="utf-8-sig")
