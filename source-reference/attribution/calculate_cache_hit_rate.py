from pathlib import Path
import json
import pandas as pd
from openpyxl.styles import Font,PatternFill,Alignment

base=Path("output/real_analysis")
u=pd.read_csv(base/"round_token_usage_deduplicated.csv")
num=["totalInputTokens","totalOutputTokens","totalTokens","inputCachedTokens","inputCacheMissTokens","inputWriteCacheTokens","cost","ttft","latency"]
for c in num: u[c]=pd.to_numeric(u[c],errors="coerce").fillna(0)
den=u.totalInputTokens.where(u.totalInputTokens>0)
u["cache_hit_rate"]=u.inputCachedTokens.div(den)
u["cache_miss_rate"]=u.inputCacheMissTokens.div(den)
u["cache_write_rate"]=u.inputWriteCacheTokens.div(den)
u["cache_accounted_tokens"]=u.inputCachedTokens+u.inputCacheMissTokens+u.inputWriteCacheTokens
u["usage_consistency_gap"]=u.cache_accounted_tokens-u.totalInputTokens
u["usage_consistency_valid"]=u.usage_consistency_gap.abs()<=1
u["cache_status"]=pd.cut(u.cache_hit_rate,[-.001,0,.3,.6,.8,1.001],labels=["零命中","低命中(<30%)","中等命中(30%-60%)","较高命中(60%-80%)","高命中(>=80%)"])
# Percent columns for easy inspection
for c in ["cache_hit_rate","cache_miss_rate","cache_write_rate"]: u[c+"_pct"]=(u[c]*100).round(2)

def aggregate(keys):
    g=(u.groupby(keys,dropna=False).agg(
      rounds=("id","size"),total_input_tokens=("totalInputTokens","sum"),total_output_tokens=("totalOutputTokens","sum"),
      cached_tokens=("inputCachedTokens","sum"),cache_miss_tokens=("inputCacheMissTokens","sum"),cache_write_tokens=("inputWriteCacheTokens","sum"),
      total_cost=("cost","sum"),avg_ttft_ms=("ttft","mean"),avg_latency_ms=("latency","mean"),
      consistent_rounds=("usage_consistency_valid","sum")).reset_index())
    d=g.total_input_tokens.where(g.total_input_tokens>0)
    g["cache_hit_rate_pct"]=(g.cached_tokens/d*100).round(2)
    g["cache_miss_rate_pct"]=(g.cache_miss_tokens/d*100).round(2)
    g["cache_write_rate_pct"]=(g.cache_write_tokens/d*100).round(2)
    g["usage_consistency_rate_pct"]=(g.consistent_rounds/g.rounds*100).round(2)
    g["total_cost"]=g.total_cost.round(6); g["avg_ttft_ms"]=g.avg_ttft_ms.round(1); g["avg_latency_ms"]=g.avg_latency_ms.round(1)
    return g.sort_values("total_input_tokens",ascending=False)

trace=aggregate(["effective_trace_id"])
provider=aggregate(["provider"])
model=aggregate(["provider","model"])
agent=None
# Join attribution to trace summary
cp=base/"classified_badcases.json"
if cp.exists():
    a=pd.DataFrame(json.loads(cp.read_text(encoding="utf-8")))[["trace_id","error_category_zh","module_id","module_name"]]
    trace=trace.merge(a,left_on="effective_trace_id",right_on="trace_id",how="left").drop(columns=["trace_id"])

u.to_csv(base/"round_cache_hit_rate.csv",index=False,encoding="utf-8-sig")
trace.to_csv(base/"trace_cache_hit_rate.csv",index=False,encoding="utf-8-sig")
provider.to_csv(base/"provider_cache_hit_rate.csv",index=False,encoding="utf-8-sig")
model.to_csv(base/"model_cache_hit_rate.csv",index=False,encoding="utf-8-sig")

summary=pd.DataFrame([
 ["去重模型调用轮次",len(u),"轮"],
 ["覆盖 Trace",u.effective_trace_id.nunique(),"个"],
 ["总输入 Token",int(u.totalInputTokens.sum()),"tokens"],
 ["缓存命中 Token",int(u.inputCachedTokens.sum()),"tokens"],
 ["缓存未命中 Token",int(u.inputCacheMissTokens.sum()),"tokens"],
 ["缓存写入 Token",int(u.inputWriteCacheTokens.sum()),"tokens"],
 ["整体加权缓存命中率",round(u.inputCachedTokens.sum()/u.totalInputTokens.sum()*100,2),"%"],
 ["整体加权缓存未命中率",round(u.inputCacheMissTokens.sum()/u.totalInputTokens.sum()*100,2),"%"],
 ["整体加权缓存写入率",round(u.inputWriteCacheTokens.sum()/u.totalInputTokens.sum()*100,2),"%"],
 ["Usage 一致轮次率",round(u.usage_consistency_valid.mean()*100,2),"%"],
 ["零缓存命中轮次",int((u.inputCachedTokens==0).sum()),"轮"],
 ["高缓存命中轮次(>=80%)",int((u.cache_hit_rate>=.8).sum()),"轮"],
],columns=["metric","value","unit"])

xlsx=base/"cache_hit_rate_report.xlsx"
with pd.ExcelWriter(xlsx,engine="openpyxl") as w:
    summary.to_excel(w,sheet_name="SUMMARY",index=False)
    trace.to_excel(w,sheet_name="TRACE",index=False)
    provider.to_excel(w,sheet_name="PROVIDER",index=False)
    model.to_excel(w,sheet_name="MODEL",index=False)
    u.to_excel(w,sheet_name="ROUND",index=False)
wb=__import__("openpyxl").load_workbook(xlsx)
fill=PatternFill("solid",fgColor="1F4E78"); font=Font(color="FFFFFF",bold=True)
for ws in wb.worksheets:
    ws.freeze_panes="A2"; ws.auto_filter.ref=ws.dimensions
    for c in ws[1]: c.fill=fill; c.font=font; c.alignment=Alignment(horizontal="center")
    for col in ws.columns:
        width=min(42,max(10,max(len(str(x.value or "")) for x in list(col)[:500])+2)); ws.column_dimensions[col[0].column_letter].width=width
wb.save(xlsx)
print(summary.to_string(index=False))
print("top_provider\n",provider[["provider","rounds","total_input_tokens","cache_hit_rate_pct","cache_miss_rate_pct","cache_write_rate_pct"]].to_string(index=False))
print("files written",xlsx)
