"""Trace denoising for ROOT-CAUSE ATTRIBUTION (not merely report display).

The output is the canonical LLM input. It preserves causal structure and removes
prompt/tool-schema/binary/repetition noise. Every retained node keeps its ID so
LLM evidence can be audited against the raw trace.
"""
from __future__ import annotations
import argparse, json, re
from pathlib import Path
from typing import Any
import pandas as pd

NOISE_BLOCKS=[
 re.compile(r"<(?:feishu|tripyoyo|available_tools|system|context|selected_skill_context)[^>]*>.*?</[^>]+>",re.I|re.S),
 re.compile(r"data:(?:image|audio|video)/[^;]+;base64,[A-Za-z0-9+/=]+",re.I),
 re.compile(r"[A-Za-z0-9+/]{2000,}={0,2}"),
]

def _json(v):
    if isinstance(v,(dict,list)): return v
    if not isinstance(v,str) or not v.strip(): return {}
    try:return json.loads(v)
    except:return {}

def clean_text(v,max_chars=1600):
    if v is None or (isinstance(v,float) and pd.isna(v)):return ""
    s=str(v).replace("\x00","")
    for p in NOISE_BLOCKS:s=p.sub("[NOISE_REMOVED]",s)
    s=re.sub(r"\n{3,}","\n\n",s).strip()
    return s if len(s)<=max_chars else s[:max_chars]+f"…[TRUNCATED:{len(s)-max_chars}]"

def compact_error(v):
    d=_json(v)
    if not d:return clean_text(v,1000)
    out={}
    def walk(x,prefix=""):
        if isinstance(x,dict):
            for k,val in x.items():
                key=f"{prefix}.{k}" if prefix else k
                if k.lower() in {"type","name","code","status","message","reason","endpoint","provider","errortype"}:out[key]=clean_text(val,500)
                elif isinstance(val,(dict,list)):walk(val,key)
        elif isinstance(x,list):
            for i,val in enumerate(x[:10]):walk(val,f"{prefix}[{i}]")
    walk(d);return json.dumps(out,ensure_ascii=False)[:2500]

def compact_tools(v):
    d=_json(v); names=[]; calls=[]
    def walk(x):
        if isinstance(x,dict):
            name=next((x.get(k) for k in ["name","toolName","identifier","apiName"] if isinstance(x.get(k),str)),None)
            if name:names.append(name)
            for k in ["arguments","args","state","status","result","error"]:
                if k in x and not isinstance(x[k],(dict,list)):calls.append(f"{k}={clean_text(x[k],300)}")
            for k,val in x.items():
                if k not in {"description","parameters","schema","systemRole","manifest"}:walk(val)
        elif isinstance(x,list):
            for y in x[:100]:walk(y)
    walk(d)
    return {"tool_names":list(dict.fromkeys(names))[:30],"call_signals":list(dict.fromkeys(calls))[:20]}

def _bool(v):
    if isinstance(v,bool):return v
    return str(v).strip().lower() in {"1","true","yes"}

def denoise_trace_nodes(rows:list[dict],max_nodes=40)->dict:
    """Return causal trace. Parent chain + error windows survive before generic context."""
    if not rows:return {"nodes":[],"stats":{"raw_nodes":0,"deduplicated_nodes":0,"retained_nodes":0,"removed_nodes":0,"error_nodes":0,"max_nodes":max_nodes},"denoising_rules":["deduplicate_node_id","remove_system_manifest_and_binary","preserve_error_nodes","preserve_full_parent_ancestry","preserve_error_temporal_window","preserve_tool_call_result_and_state_signals","explicitly_mark_truncation"]}
    # stable de-dup by node ID; keep latest representation
    byid={}
    for i,r in enumerate(rows):
        nid=str(r.get("id") or f"_row_{i}");byid[nid]={**r,"_order":i,"id":nid}
    nodes=sorted(byid.values(),key=lambda r:(str(r.get("created_at") or ""),r["_order"]))
    idmap={r["id"]:r for r in nodes}; children={}
    for r in nodes:children.setdefault(str(r.get("parent_id") or ""),[]).append(r["id"])
    error_ids={r["id"] for r in nodes if _bool(r.get("is_error")) or bool(compact_error(r.get("error"))) or bool(clean_text(r.get("error_message"),500))}
    keep=set(error_ids); reasons={nid:{"error_node"} for nid in error_ids}
    # full parent ancestry is stronger attribution evidence than arbitrary proximity
    for eid in error_ids:
        cur=idmap.get(eid); guard=0
        while cur and cur.get("parent_id") and guard<100:
            pid=str(cur.get("parent_id"));
            if pid not in idmap:break
            keep.add(pid);reasons.setdefault(pid,set()).add("ancestor_of_error");cur=idmap[pid];guard+=1
    # temporal context and descendants reveal call/result/state transitions
    for i,r in enumerate(nodes):
        if r["id"] in error_ids:
            for j in range(max(0,i-3),min(len(nodes),i+4)):
                nid=nodes[j]["id"];keep.add(nid);reasons.setdefault(nid,set()).add("error_window")
            for cid in children.get(r["id"],[])[:3]:keep.add(cid);reasons.setdefault(cid,set()).add("child_of_error")
    # nearest meaningful role before first error
    first_error=min((i for i,r in enumerate(nodes) if r["id"] in error_ids),default=len(nodes)-1)
    for role in ["user","assistant","tool","task"]:
        idx=[i for i,r in enumerate(nodes[:first_error]) if str(r.get("role"))==role]
        if idx:
            nid=nodes[idx[-1]]["id"];keep.add(nid);reasons.setdefault(nid,set()).add("latest_role_before_error")
    selected=[]
    for r in nodes:
        if r["id"] not in keep:continue
        content=clean_text(r.get("content"));reasoning=clean_text(r.get("reasoning"),800);tools=compact_tools(r.get("tools"));err=compact_error(r.get("error") or r.get("error_raw"))
        # Keep empty structural ancestor because parent chain itself is evidence.
        selected.append({"node_id":r["id"],"parent_id":str(r.get("parent_id") or ""),"created_at":str(r.get("created_at") or ""),"role":str(r.get("role") or ""),"is_error":r["id"] in error_ids,"retention_reason":sorted(reasons.get(r["id"],[])),"provider":str(r.get("provider") or ""),"model":str(r.get("model") or ""),"error_type":str(r.get("error_type") or ""),"error_message":clean_text(r.get("error_message"),600),"error_detail":err,"content":content,"reasoning":reasoning,"tool_names":tools["tool_names"],"tool_signals":tools["call_signals"]})
    if len(selected)>max_nodes:
        # error + ancestors first, then temporal context
        score=lambda n:(10000 if n["is_error"] else 0)+(5000 if "ancestor_of_error" in n["retention_reason"] else 0)+(1000 if n["error_detail"] or n["error_message"] else 0)+(100 if n["tool_names"] else 0)
        selected=sorted(sorted(selected,key=score,reverse=True)[:max_nodes],key=lambda n:n["created_at"])
    return {"nodes":selected,"stats":{"raw_nodes":len(rows),"deduplicated_nodes":len(nodes),"retained_nodes":len(selected),"removed_nodes":len(rows)-len(selected),"error_nodes":len(error_ids),"max_nodes":max_nodes},"denoising_rules":["deduplicate_node_id","remove_system_manifest_and_binary","preserve_error_nodes","preserve_full_parent_ancestry","preserve_error_temporal_window","preserve_tool_call_result_and_state_signals","explicitly_mark_truncation"]}

def enrich_traces_from_xlsx(traces:list[dict],source_xlsx:str,max_nodes=40)->list[dict]:
    raw=pd.read_excel(source_xlsx,sheet_name="RAW_NODES")
    groups={str(k):g.to_dict("records") for k,g in raw.groupby("effective_trace_id",dropna=False)}
    out=[]
    for t in traces:
        tid=str(t.get("id") or t.get("trace_id") or t.get("effective_trace_id") or "")
        den=denoise_trace_nodes(groups.get(tid,[]),max_nodes=max_nodes)
        out.append({**t,"denoised_trace":den["nodes"],"denoising_stats":den["stats"],"denoising_rules":den["denoising_rules"]})
    return out

def main():
    p=argparse.ArgumentParser();p.add_argument("--input",required=True);p.add_argument("--source-xlsx",required=True);p.add_argument("--output",default="./output/denoised_traces.json");p.add_argument("--max-nodes",type=int,default=40);a=p.parse_args()
    traces=json.loads(Path(a.input).read_text(encoding="utf-8"));out=enrich_traces_from_xlsx(traces,a.source_xlsx,a.max_nodes);Path(a.output).parent.mkdir(parents=True,exist_ok=True);Path(a.output).write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding="utf-8");print(json.dumps({"traces":len(out),"with_denoised_trace":sum(bool(x["denoised_trace"]) for x in out),"output":a.output},ensure_ascii=False))
if __name__=="__main__":main()
