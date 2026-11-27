"""Generate an Excel report for the highest-frequency badcase category.

Inputs:
- classified_badcases.json: one primary attribution per effective trace
- Optional source xlsx: RAW_NODES / ERROR_EVENTS / TRACE_MANIFEST

Output workbook sheets:
DEV_SUMMARY, DEV_CATEGORY_RANKING, DEV_MODULE_RANKING, REPRESENTATIVE_CASES,
CASE_DETAILS, CAUSAL_TRACE, ATTRIBUTION_QUALITY, RAW_CATEGORY_RANKING, NOISE_RULES
"""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
from typing import Any
import pandas as pd
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.formatting.rule import ColorScaleRule
from trace_denoiser import denoise_trace_nodes

NOISE_PATTERNS = [
    re.compile(r"<(?:feishu|tripyoyo|available_tools|system|context)_[^>]*>.*?</[^>]+>", re.I|re.S),
    re.compile(r"data:(?:image|audio|video)/[^;]+;base64,[A-Za-z0-9+/=]+", re.I),
    re.compile(r"[A-Za-z0-9+/]{2000,}={0,2}"),
]

def safe_json(v: Any) -> Any:
    if not isinstance(v,str) or not v.strip(): return {}
    try: return json.loads(v)
    except Exception: return {}

def clean_text(v: Any, max_chars=1200) -> str:
    if v is None or (isinstance(v,float) and pd.isna(v)): return ""
    text=str(v).replace("\x00","")
    for p in NOISE_PATTERNS: text=p.sub("[已移除大段系统指令或二进制数据]",text)
    text=re.sub(r"\n{3,}","\n\n",text).strip()
    if len(text)>max_chars: text=text[:max_chars]+f"…[截断{len(text)-max_chars}字符]"
    return text

def tool_names(v: Any) -> str:
    obj=safe_json(v)
    names=[]
    def walk(x):
        if isinstance(x,dict):
            for k,val in x.items():
                if k in {"name","toolName","identifier","apiName"} and isinstance(val,str): names.append(val)
                elif k not in {"description","parameters","schema","systemRole"}: walk(val)
        elif isinstance(x,list):
            for y in x[:100]: walk(y)
    walk(obj)
    return ", ".join(dict.fromkeys(names))[:1000]

def parse_usage(v: Any) -> dict:
    m=safe_json(v)
    keys=["totalInputTokens","totalOutputTokens","totalTokens","inputCachedTokens","inputCacheMissTokens","inputWriteCacheTokens","cost"]
    return {k:pd.to_numeric(m.get(k),errors="coerce") if k in m else None for k in keys}

def select_trace_nodes(g: pd.DataFrame, max_nodes=12) -> pd.DataFrame:
    """Keep error nodes and small causal context; remove duplicate/empty/system-manifest noise."""
    g=g.sort_values("created_at").drop_duplicates("id",keep="last").copy().reset_index(drop=True)
    g["clean_content"]=g["content"].map(clean_text)
    g["clean_reasoning"]=g["reasoning"].map(lambda x:clean_text(x,600))
    g["tool_names"]=g["tools"].map(tool_names)
    g["has_signal"]=(g["is_error"].fillna(False).astype(bool)|g.clean_content.ne("")|g.clean_reasoning.ne("")|g.tool_names.ne(""))
    g=g[g.has_signal].copy().reset_index(drop=True)
    if g.empty: return g
    error_idx=set(g.index[g.is_error.fillna(False).astype(bool)].tolist())
    keep=set(error_idx)
    for i in error_idx:
        keep.update(range(max(0,i-2),min(len(g),i+3)))
    # Preserve compact conversational spine: first user, latest user/tool/assistant before each error.
    user_idx=g.index[g.role.eq("user")].tolist()
    if user_idx: keep.add(user_idx[0])
    for i in sorted(error_idx):
        before=g.loc[:i-1]
        for role in ["user","tool","assistant","task"]:
            idx=before.index[before.role.eq(role)].tolist()
            if idx: keep.add(idx[-1])
    chosen=g.loc[sorted(keep)].copy()
    if len(chosen)>max_nodes:
        # Error rows always survive; fill remaining slots by proximity to an error.
        chosen["priority"]=chosen.is_error.fillna(False).astype(bool).map({True:100000,False:0})
        if error_idx:
            positions=sorted(error_idx)
            chosen["priority"]+=chosen.index.map(lambda i:1000-min(abs(i-e) for e in positions))
        chosen=chosen.sort_values(["priority","created_at"],ascending=[False,True]).head(max_nodes).sort_values("created_at")
    return chosen

def aggregate_usage(raw: pd.DataFrame) -> pd.DataFrame:
    rows=[]
    for _,r in raw.iterrows():
        u=parse_usage(r.get("metadata"))
        if any(pd.notna(v) for v in u.values()): rows.append({"trace_id":r.effective_trace_id,"id":r.id,**u})
    if not rows: return pd.DataFrame(columns=["trace_id"])
    u=pd.DataFrame(rows).drop_duplicates("id",keep="last")
    g=u.groupby("trace_id",dropna=False).agg(
      llm_rounds=("id","size"),total_input_tokens=("totalInputTokens","sum"),total_output_tokens=("totalOutputTokens","sum"),
      cached_tokens=("inputCachedTokens","sum"),cache_miss_tokens=("inputCacheMissTokens","sum"),cache_write_tokens=("inputWriteCacheTokens","sum"),total_cost=("cost","sum")).reset_index()
    den=g.total_input_tokens.where(g.total_input_tokens>0)
    g["cache_hit_rate_pct"]=(g.cached_tokens/den*100).round(2)
    return g

def build_report(classified_path: str, source_xlsx: str|None, output_path: str, case_count=5, max_trace_nodes=12):
    records=json.loads(Path(classified_path).read_text(encoding="utf-8"))
    df=pd.DataFrame(records)
    if df.empty: raise ValueError("classified_badcases.json 为空")
    ranking=(df.groupby(["error_category","error_category_zh","layer_id","layer_name","module_id","module_name"],dropna=False)
             .size().reset_index(name="trace_count").sort_values("trace_count",ascending=False).reset_index(drop=True))
    total=len(df); ranking["badcase_share_pct"]=(ranking.trace_count/total*100).round(2); ranking.insert(0,"rank",range(1,len(ranking)+1))

    # Responsibility boundary: attribution/observability quality is owned by the analysis platform,
    # not ranked as a developer-facing online-success problem.
    attribution_mask=(df["module_id"].eq("L8.3")|df["badcase_kind"].eq("observability_gap")|df["module_id"].eq("UNCLASSIFIED"))
    product_df=df[~attribution_mask].copy()
    attribution_df=df[attribution_mask].copy()
    dev_ranking=(product_df.groupby(["error_category","error_category_zh","layer_id","layer_name","module_id","module_name"],dropna=False)
      .size().reset_index(name="trace_count").sort_values("trace_count",ascending=False).reset_index(drop=True))
    dev_ranking["share_of_all_badcases_pct"]=(dev_ranking.trace_count/total*100).round(2)
    dev_ranking["share_of_attributable_product_issues_pct"]=(dev_ranking.trace_count/max(len(product_df),1)*100).round(2)
    dev_ranking.insert(0,"rank",range(1,len(dev_ranking)+1))
    dev_modules=(product_df.groupby(["layer_id","layer_name","module_id","module_name"],dropna=False).size().reset_index(name="trace_count").sort_values("trace_count",ascending=False).reset_index(drop=True))
    dev_modules["share_of_all_badcases_pct"]=(dev_modules.trace_count/total*100).round(2); dev_modules.insert(0,"rank",range(1,len(dev_modules)+1))
    quality=(attribution_df.groupby(["error_category","error_category_zh","layer_id","layer_name","module_id","module_name"],dropna=False).size().reset_index(name="trace_count").sort_values("trace_count",ascending=False).reset_index(drop=True))
    quality["share_of_all_badcases_pct"]=(quality.trace_count/total*100).round(2)
    top=dev_ranking.iloc[0]; top_df=product_df[product_df.error_category.eq(top.error_category)].copy()

    raw=events=manifest=None; usage=pd.DataFrame(columns=["trace_id"]); denoised=[]
    if source_xlsx:
        xls=pd.ExcelFile(source_xlsx)
        if "RAW_NODES" in xls.sheet_names:
            raw=pd.read_excel(source_xlsx,sheet_name="RAW_NODES")
            usage=aggregate_usage(raw)
        if "ERROR_EVENTS" in xls.sheet_names: events=pd.read_excel(source_xlsx,sheet_name="ERROR_EVENTS")
        if "TRACE_MANIFEST" in xls.sheet_names: manifest=pd.read_excel(source_xlsx,sheet_name="TRACE_MANIFEST")
    details=top_df.merge(usage,left_on="trace_id",right_on="trace_id",how="left")
    if manifest is not None:
        details=details.merge(manifest[[c for c in ["effective_trace_id","first_error_at","last_error_at","error_count","node_count","root_count","orphan_count","chain_first_at","chain_last_at"] if c in manifest]],left_on="trace_id",right_on="effective_trace_id",how="left").drop(columns=["effective_trace_id"],errors="ignore")
    # Representative cases: high confidence + strong evidence + diverse provider/model.
    details["case_score"]=pd.to_numeric(details.get("confidence",0),errors="coerce").fillna(0)*100+pd.to_numeric(details.get("event_count",0),errors="coerce").fillna(0).clip(upper=20)
    details=details.sort_values(["case_score","trace_timestamp"],ascending=[False,True])
    reps=details.drop_duplicates([c for c in ["provider","model"] if c in details] or ["trace_id"]).head(case_count).copy()
    if len(reps)<case_count: reps=pd.concat([reps,details[~details.trace_id.isin(reps.trace_id)].head(case_count-len(reps))]).drop_duplicates("trace_id")
    reps.insert(0,"case_no",range(1,len(reps)+1))

    if raw is not None:
        for case_no,tid in enumerate(reps.trace_id,1):
            g=raw[raw.effective_trace_id.eq(tid)].copy()
            causal=denoise_trace_nodes(g.to_dict("records"),max_nodes=max_trace_nodes)
            for seq,r in enumerate(causal["nodes"],1):
                denoised.append({"case_no":case_no,"trace_id":tid,"seq":seq,"created_at":r.get("created_at"),"role":r.get("role"),"is_error":r.get("is_error"),"node_id":r.get("node_id"),"parent_id":r.get("parent_id"),"retention_reason":json.dumps(r.get("retention_reason",[]),ensure_ascii=False),"provider":r.get("provider"),"model":r.get("model"),"error_type":r.get("error_type"),"error_message":r.get("error_message"),"error_detail":r.get("error_detail"),"content":r.get("content"),"reasoning":r.get("reasoning"),"tool_names":json.dumps(r.get("tool_names",[]),ensure_ascii=False),"tool_signals":json.dumps(r.get("tool_signals",[]),ensure_ascii=False),"noise_action":"此表直接复用归因前因果去噪器；保留 Error、Parent 祖先链、错误时间窗口和工具/状态信号"})
    trace_df=pd.DataFrame(denoised)

    summary=pd.DataFrame([
      ["报告受众","产品与运行链路开发人员"],
      ["责任边界","开发榜只展示影响线上成功率且需要开发修复的问题；L8.3/观测缺口/未分类由归因与可观测性建设方内部治理"],
      ["统计单位","effective_trace_id（每个 Trace 只计一个主归因）"],
      ["Badcase Trace 总数",total],
      ["可归因产品问题 Trace",len(product_df)],
      ["归因能力问题 Trace",len(attribution_df)],
      ["开发榜最高频错误类别",top.error_category_zh],
      ["错误类别编码",top.error_category],
      ["Trace 数",int(top.trace_count)],
      ["占全部 Badcase Trace 比例",f"{top.share_of_all_badcases_pct:.2f}%"],
      ["占可归因产品问题比例",f"{top.share_of_attributable_product_issues_pct:.2f}%"],
      ["严格报错率","无法从仅含错误 Trace 的数据集计算；需要同期全部请求/Trace 总数作为分母"],
      ["归因层",f"{top.layer_id} {top.layer_name}"],
      ["归因模块",f"{top.module_id} {top.module_name}"],
      ["代表 Case 数",len(reps)],
      ["Trace 去噪用途","去噪结果是 LLM 根因归因的核心输入；Excel 仅复用并展示相同因果 Trace"],
      ["Trace 去噪规则","节点 ID 去重；重建父子链；移除系统/Manifest/Base64；保留 Error、完整 Parent 祖先链、错误时间窗口及 Tool Call/Result/状态信号"],
    ],columns=["item","value"])
    rules=pd.DataFrame([
      [1,"去重","相同 node id 仅保留最后一条"],[2,"去空","删除无 content/reasoning/tool/error 的节点"],
      [3,"去系统噪音","移除注入的长系统指南、工具 Manifest 等标签块"],[4,"去二进制","移除 Base64/Data URI"],
      [5,"保留因果窗口","保留错误节点前后各 2 个节点，以及最近 user/tool/assistant/task"],[6,"限制长度","content 1200 字、reasoning 600 字，超出标记截断"],
      [7,"限制节点","每个代表 Case 最多保留指定数量关键节点"],[8,"统计口径","类别占比=类别 Trace 数/全部 Badcase Trace 数；并非严格报错率"],
    ],columns=["rule_no","rule","description"])

    # Friendly case/detail columns.
    rep_cols=[c for c in ["case_no","trace_id","trace_timestamp","error_category_zh","layer_id","layer_name","module_id","module_name","original_error_type","all_error_types","provider","model","agent_id","confidence","reason","evidence","event_count","chain_node_count","llm_rounds","total_input_tokens","total_output_tokens","cached_tokens","cache_miss_tokens","cache_write_tokens","cache_hit_rate_pct","total_cost"] if c in reps]
    detail_cols=[c for c in ["trace_id","trace_timestamp","original_error_type","all_error_types","provider","model","agent_id","confidence","needs_review","reason","evidence","event_count","chain_node_count","first_error_at","last_error_at","error_count","node_count","llm_rounds","total_input_tokens","total_output_tokens","cached_tokens","cache_miss_tokens","cache_write_tokens","cache_hit_rate_pct","total_cost"] if c in details]
    for frame in [reps,details]:
        for c in ["all_error_types","evidence","candidate_modules"]:
            if c in frame: frame[c]=frame[c].apply(lambda x:json.dumps(x,ensure_ascii=False) if isinstance(x,(list,dict)) else x)
    out=Path(output_path); out.parent.mkdir(parents=True,exist_ok=True)
    with pd.ExcelWriter(out,engine="openpyxl") as w:
        summary.to_excel(w,sheet_name="DEV_SUMMARY",index=False)
        dev_ranking.to_excel(w,sheet_name="DEV_CATEGORY_RANKING",index=False)
        dev_modules.to_excel(w,sheet_name="DEV_MODULE_RANKING",index=False)
        reps[rep_cols].to_excel(w,sheet_name="REPRESENTATIVE_CASES",index=False)
        details[detail_cols].to_excel(w,sheet_name="CASE_DETAILS",index=False)
        trace_df.to_excel(w,sheet_name="CAUSAL_TRACE",index=False)
        quality.to_excel(w,sheet_name="ATTRIBUTION_QUALITY",index=False)
        ranking.to_excel(w,sheet_name="RAW_CATEGORY_RANKING",index=False)
        rules.to_excel(w,sheet_name="NOISE_RULES",index=False)
    wb=__import__("openpyxl").load_workbook(out)
    header_fill=PatternFill("solid",fgColor="1F4E78"); header_font=Font(color="FFFFFF",bold=True)
    for ws in wb.worksheets:
        ws.freeze_panes="A2"; ws.auto_filter.ref=ws.dimensions
        for c in ws[1]: c.fill=header_fill; c.font=header_font; c.alignment=Alignment(horizontal="center",vertical="center",wrap_text=True)
        for col in ws.columns:
            vals=list(col); width=min(55,max(10,max(len(str(x.value or "")) for x in vals[:400])+2)); ws.column_dimensions[vals[0].column_letter].width=width
        for row in ws.iter_rows(min_row=2):
            for c in row: c.alignment=Alignment(vertical="top",wrap_text=True)
    if "DEV_CATEGORY_RANKING" in wb.sheetnames:
        ws=wb["DEV_CATEGORY_RANKING"]
        ws.conditional_formatting.add(f"H2:H{ws.max_row}",ColorScaleRule(start_type="min",start_color="FFFFFF",end_type="max",end_color="F8696B"))
    wb.save(out)
    return {"output":str(out),"total_badcase_traces":total,"product_issue_traces":len(product_df),"attribution_quality_traces":len(attribution_df),"top_category":top.error_category,"top_category_zh":top.error_category_zh,"top_count":int(top.trace_count),"top_share_pct":float(top.share_of_all_badcases_pct),"layer_id":top.layer_id,"layer_name":top.layer_name,"module_id":top.module_id,"module_name":top.module_name,"representative_cases":len(reps),"denoised_trace_rows":len(trace_df)}

def main():
    p=argparse.ArgumentParser(description="生成最高频错误类别 Case 与去噪 Trace Excel")
    p.add_argument("--classified",default="./output/classified_badcases.json")
    p.add_argument("--source-xlsx",default=None)
    p.add_argument("--output",default="./output/high_frequency_error_case_report.xlsx")
    p.add_argument("--case-count",type=int,default=5)
    p.add_argument("--max-trace-nodes",type=int,default=12)
    a=p.parse_args(); print(json.dumps(build_report(a.classified,a.source_xlsx,a.output,a.case_count,a.max_trace_nodes),ensure_ascii=False,indent=2))
if __name__=="__main__": main()
