"""Deterministic representative Trace selector.

Selection semantics:
1) highest-frequency developer error category;
2) dominant normalized error signature within that category;
3) most complete and debuggable Trace within that signature;
4) deterministic tie-breakers.

This is hierarchical filtering, not a weighted trade-off: a rare error shape can
never win merely because its Trace is longer or richer.
"""
from __future__ import annotations
import json, math, re
from typing import Any
import pandas as pd


def normalize_error_message(v:Any)->str:
    s="" if v is None or (isinstance(v,float) and pd.isna(v)) else str(v)
    s=s.lower().strip()
    s=re.sub(r"(?:op|call|msg|tpc)_[a-z0-9]+","<id>",s)
    s=re.sub(r"\b\d{4}-\d{2}-\d{2}[^ ]*","<time>",s)
    s=re.sub(r"\b\d+\b","<n>",s)
    return re.sub(r"\s+"," ",s)[:300]

def has_error_body(raw)->bool:
    if not isinstance(raw,str) or not raw.strip():return False
    try:return bool(json.loads(raw))
    except:return False

def select_representative_trace(classified:pd.DataFrame,events:pd.DataFrame,raw_nodes:pd.DataFrame,exclude_attribution_quality=True):
    d=classified.copy()
    if exclude_attribution_quality:
        d=d[~(d.module_id.eq("L8.3")|d.badcase_kind.eq("observability_gap")|d.module_id.eq("UNCLASSIFIED"))]

    # Gate 1: highest-frequency category. Tie: category code ascending.
    category_rank=(d.groupby(["error_category","error_category_zh"],dropna=False).trace_id.nunique().reset_index(name="trace_count").sort_values(["trace_count","error_category"],ascending=[False,True]).reset_index(drop=True))
    top=category_rank.iloc[0]; cat=str(top.error_category); candidates=d[d.error_category.eq(cat)].copy()

    ev=events[events.effective_trace_id.isin(candidates.trace_id)].copy()
    ev["norm_message"]=ev.error_message.map(normalize_error_message)
    ev["signature"]=ev.error_type.fillna("").astype(str)+" || "+ev.norm_message
    first_ev=ev.sort_values(["effective_trace_id","created_at","id"]).drop_duplicates("effective_trace_id",keep="first")
    candidates=candidates.merge(first_ev[["effective_trace_id","signature","error_type","error_message","error_raw"]],left_on="trace_id",right_on="effective_trace_id",how="left",suffixes=("","_event")).drop(columns=["effective_trace_id"],errors="ignore")

    # Gate 2: dominant normalized signature. Tie: signature lexicographic.
    signature_rank=(candidates.groupby("signature",dropna=False).trace_id.nunique().reset_index(name="signature_frequency").sort_values(["signature_frequency","signature"],ascending=[False,True]).reset_index(drop=True))
    dominant_signature=signature_rank.iloc[0].signature
    candidates["is_dominant_signature"]=candidates.signature.eq(dominant_signature)

    # Metrics used only within the dominant signature.
    dominant=candidates[candidates.is_dominant_signature].copy()
    combo=dominant.provider.fillna("").astype(str)+" || "+dominant.model.fillna("").astype(str)
    combo_freq=combo.value_counts()
    failures=pd.to_numeric(dominant.event_count,errors="coerce").fillna(0).astype(int)
    failure_mode=int(sorted(failures.mode().tolist())[0]) if len(failures) else 0
    lengths=pd.to_numeric(dominant.chain_node_count,errors="coerce").fillna(0)
    length_median=float(lengths.median()) if len(lengths) else 0
    raw_groups={str(k):g for k,g in raw_nodes[raw_nodes.effective_trace_id.isin(candidates.trace_id)].groupby("effective_trace_id")}

    rows=[]
    for _,r in candidates.iterrows():
        tid=str(r.trace_id); g=raw_groups.get(tid,pd.DataFrame()); roles=set(g.role.dropna().astype(str)) if not g.empty else set()
        ids=set(g.id.dropna().astype(str)) if not g.empty else set()
        parent_valid=(not g.empty and any(str(x) in ids for x in g.parent_id.dropna()))
        has_user="user" in roles; has_assistant="assistant" in roles; has_tool="tool" in roles; has_body=has_error_body(r.get("error_raw"))
        completeness=sum([has_user,has_assistant,has_tool,has_body,parent_valid])
        # Debuggability: concrete error text/body, chronological nodes, provider/model, and causal parent links.
        concrete_error=bool(str(r.get("error_message") or "").strip()) and has_body
        time_coverage=(g.created_at.notna().mean() if not g.empty and "created_at" in g else 0)
        debug_score=round(completeness*10 + (15 if concrete_error else 0) + min(15,time_coverage*15),2) # /80
        pair=f"{r.get('provider','')} || {r.get('model','')}"
        pair_frequency=int(combo_freq.get(pair,0)) if bool(r.is_dominant_signature) else 0
        n=int(r.get("chain_node_count",0) or 0)
        length_distance=abs(math.log1p(n)-math.log1p(length_median)) if length_median>0 and n>0 else 999
        failure_distance=abs(int(r.get("event_count",0) or 0)-failure_mode)
        rows.append({
          "trace_id":tid,"error_category":cat,"error_category_zh":top.error_category_zh,
          "signature":r.get("signature"),"is_dominant_signature":bool(r.is_dominant_signature),
          "signature_frequency":int(signature_rank.loc[signature_rank.signature.eq(r.get('signature')),'signature_frequency'].iloc[0]) if any(signature_rank.signature.eq(r.get('signature'))) else 0,
          "provider":r.get("provider"),"model":r.get("model"),"provider_model_frequency_in_dominant_signature":pair_frequency,
          "failure_count":int(r.get("event_count",0) or 0),"dominant_signature_failure_mode":failure_mode,"failure_distance_to_mode":failure_distance,
          "chain_node_count":n,"dominant_signature_chain_median":length_median,"chain_log_distance_to_median":round(length_distance,4),
          "has_user":has_user,"has_assistant":has_assistant,"has_tool":has_tool,"has_error_body":has_body,"has_parent_link":parent_valid,"concrete_error":concrete_error,
          "evidence_completeness_items":completeness,"debuggability_score":debug_score,"confidence":float(r.get("confidence",0) or 0)
        })
    audit=pd.DataFrame(rows)
    # Hierarchical ordering. Only after dominant signature do completeness/debuggability decide.
    audit=audit.sort_values([
      "is_dominant_signature","debuggability_score","evidence_completeness_items",
      "provider_model_frequency_in_dominant_signature","failure_distance_to_mode",
      "chain_log_distance_to_median","confidence","trace_id"],
      ascending=[False,False,False,False,True,True,False,True]).reset_index(drop=True)
    audit.insert(0,"rank",range(1,len(audit)+1)); selected=audit.iloc[0]
    rules=pd.DataFrame([
      [1,"最高频开发错误类别","按去重 Trace 数降序；并列按 error_category 字典序"],
      [2,"最主流报错形态","对首个 Error Event 的 errorType + 标准化 errorMessage 分组，选择 Trace 数最多的签名；并列按签名字典序"],
      [3,"信息最全、可调试","仅在主流签名内比较：User、Assistant、Tool、Error Body、Parent Link、时间完整性和具体错误正文"],
      [4,"主流运行环境","信息完整度并列时，Provider/Model 组合频次更高者优先"],
      [5,"典型运行形态","再按失败次数接近众数、链路长度接近中位数排序"],
      [6,"确定性并列规则","最后按归因置信度降序、Trace ID 字典序升序"],
    ],columns=["priority","selection_gate","definition"])
    return selected.to_dict(),audit,rules,category_rank,signature_rank
