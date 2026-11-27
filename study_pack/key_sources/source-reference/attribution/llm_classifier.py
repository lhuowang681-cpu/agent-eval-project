"""使用 OpenAI 兼容 LLM 对 Langfuse badcase 做统一归因。"""
from __future__ import annotations
import argparse, json, os, random, re, time
from typing import Any
from dotenv import load_dotenv
from tqdm import tqdm
from taxonomy import get_module_by_id, taxonomy_to_prompt_str

load_dotenv()
RETRY = int(os.getenv("LLM_RETRY", "3"))
MODEL = os.getenv("LLM_MODEL", "gpt-4o")
TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0"))
MAX_TOKENS = int(os.getenv("LLM_MAX_TOKENS", "1400"))
REVIEW_THRESHOLD = float(os.getenv("REVIEW_CONFIDENCE_THRESHOLD", "0.72"))

SYSTEM_PROMPT = """你是 TripYoYo Agent Badcase 根因归因专家。请依据统一归因树，把一条 badcase 归为一个主根因模块。

统一归因树（唯一可选模块）：
{taxonomy}

判定规则：
1. 只能从上述 56 个固定模块中选择主归因，不得创建新模块。
2. errorType 与 errorPhase 只是证据，不能直接推出唯一模块。
3. 选择“最早产生异常数据”的模块，而不是下游最终报错位置。例如流式阶段已拼坏 Tool Arguments，应归 L5.5，而不是下游 JSON.parse 报错的 L6.1。
4. 质量问题同样归到能力模块：应使用 Tool 却未调用归 L2.2；Tool Prompt 未暴露工具归 L4.6；Skill 未出现在清单归 L4.7；Rubric/Judge 不稳定归 L8.8。
5. 只有明确因为 Trace、Span、Error Body、Snapshot 或日志缺失而无法定位，才归 L8.3 Observability；不能因为分析困难就归 Observability。
6. 必须保留日志真实 original_error_type 与 error_phase；缺失填空字符串，禁止编造。
7. error_category 使用稳定、可聚合的英文 snake_case，不要带 trace id、模型名或随机数字。
8. `denoised_trace` 是归因的主要证据。必须沿 parent_id 和时间顺序寻找最早产生异常数据的节点；后续报错节点只能作为传播证据。
9. evidence 必须引用去噪 Trace 中真实存在的 node_id，最多 5 条；候选模块最多 3 个且不得与主模块重复。
10. 如果输入含 denoised_trace，必须输出 first_abnormal_node_id、root_cause_evidence_node_ids 和 trace_causal_summary；不得只按 errorType 分类。
11. 只返回 JSON，不要 Markdown。

JSON schema：
{{
 "badcase_kind":"runtime_error|quality_badcase|performance_badcase|eval_badcase|observability_gap",
 "error_category":"snake_case",
 "error_category_zh":"中文短标签",
 "original_error_type":"真实值或空字符串",
 "error_phase":"provider_initialization|llm_execution|tool_execution|plugin_gateway|空字符串",
 "module_id":"Lx.y",
 "confidence":0.0,
 "first_abnormal_node_id":"去噪Trace中的节点ID或空字符串",
 "root_cause_evidence_node_ids":["去噪Trace中的证据节点ID"],
 "trace_causal_summary":"异常数据如何沿父子链/时间线传播的摘要",
 "evidence":["node_id: 该节点的具体证据"],
 "reason":"100字以内主根因解释",
 "candidate_modules":[{{"module_id":"Lx.y","reason":"候选理由"}}]
}}
"""

USER_TEMPLATE = """请分析以下 badcase：
{payload}
"""

def _client():
    from openai import OpenAI
    key = os.getenv("OPENAI_API_KEY")
    if not key:
        raise RuntimeError("缺少 OPENAI_API_KEY，请通过安全凭证或 .env 配置")
    return OpenAI(api_key=key, base_url=os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1"))

def _safe(value: Any, limit=8000):
    if value is None: return ""
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return text[:limit]

def build_payload(trace: dict) -> dict:
    keys = ["id","name","timestamp","tags","scores","error_text","error_type","error_phase","input","output","metadata","observations","events","state","tool_calls","denoised_trace","denoising_stats","denoising_rules"]
    return {k: trace.get(k) for k in keys if trace.get(k) not in (None,"",[],{})}

def _extract_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text, flags=re.I|re.S)
    try: return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m: raise
        return json.loads(m.group(0))

def _fallback(trace, reason):
    # 分类器调用失败不等于业务根因是 Observability；保留为未分类并进入人工复核，避免伪造模块统计。
    return {
      "trace_id": trace.get("id", ""), "trace_name": trace.get("name", ""),
      "trace_timestamp": trace.get("timestamp", ""), "badcase_kind":"classification_failed",
      "error_category":"classification_failed", "error_category_zh":"归因失败",
      "original_error_type": _safe(trace.get("error_type"),100), "error_phase": _safe(trace.get("error_phase"),100),
      "layer_id":"UNCLASSIFIED", "layer_name":"未分类", "module_id":"UNCLASSIFIED", "module_name":"未分类",
      "confidence":0.0, "needs_review":True, "first_abnormal_node_id":"", "root_cause_evidence_node_ids":[],
      "trace_causal_summary":"", "denoising_stats":trace.get("denoising_stats",{}),
      "evidence":[], "reason":reason[:100], "candidate_modules":[]}

def normalize_result(raw: dict, trace: dict) -> dict:
    mid = str(raw.get("module_id", "")).strip()
    module = get_module_by_id(mid)
    if not module:
        return _fallback(trace, f"模型返回非法模块 {mid}")
    try: confidence = max(0.0, min(1.0, float(raw.get("confidence", 0))))
    except Exception: confidence = 0.0
    category = re.sub(r"[^a-z0-9_]+", "_", str(raw.get("error_category", "unknown_badcase")).lower()).strip("_") or "unknown_badcase"
    phase = str(raw.get("error_phase", "") or "")
    allowed_phases = {"", "provider_initialization","llm_execution","tool_execution","plugin_gateway"}
    if phase not in allowed_phases: phase = ""
    original_type = str(raw.get("original_error_type", "") or trace.get("error_type", "") or "")[:200]
    candidates=[]
    for c in raw.get("candidate_modules", [])[:3]:
        cmid = str(c.get("module_id", "")) if isinstance(c, dict) else str(c)
        cm = get_module_by_id(cmid)
        if cm and cmid != mid: candidates.append({"module_id":cmid,"module_name":cm["name"],"reason":str(c.get("reason", ""))[:100] if isinstance(c,dict) else ""})
    return {
      "trace_id":trace.get("id", ""), "trace_name":trace.get("name", ""), "trace_timestamp":trace.get("timestamp", ""),
      "badcase_kind":raw.get("badcase_kind", "runtime_error"), "error_category":category,
      "error_category_zh":str(raw.get("error_category_zh", category))[:30], "original_error_type":original_type,
      "error_phase":phase, "layer_id":module["layer_id"], "layer_name":module["layer_name"],
      "module_id":mid, "module_name":module["name"], "confidence":confidence,
      "needs_review":confidence < REVIEW_THRESHOLD or mid == "L8.3",
      "first_abnormal_node_id":str(raw.get("first_abnormal_node_id", ""))[:200],
      "root_cause_evidence_node_ids":[str(x)[:200] for x in raw.get("root_cause_evidence_node_ids", [])[:5]],
      "trace_causal_summary":str(raw.get("trace_causal_summary", ""))[:1000],
      "denoising_stats":trace.get("denoising_stats", {}),
      "evidence":[str(x)[:300] for x in raw.get("evidence", [])[:5]], "reason":str(raw.get("reason", ""))[:200],
      "candidate_modules":candidates}

def classify_single(trace: dict, retry=RETRY) -> dict:
    messages=[{"role":"system","content":SYSTEM_PROMPT.format(taxonomy=taxonomy_to_prompt_str())},
              {"role":"user","content":USER_TEMPLATE.format(payload=_safe(build_payload(trace),12000))}]
    client=_client()
    for attempt in range(retry):
        try:
            kwargs=dict(model=MODEL, temperature=TEMPERATURE, max_tokens=MAX_TOKENS, messages=messages)
            try: resp=client.chat.completions.create(**kwargs, response_format={"type":"json_object"})
            except Exception: resp=client.chat.completions.create(**kwargs)
            return normalize_result(_extract_json(resp.choices[0].message.content), trace)
        except Exception as e:
            if attempt == retry-1: return _fallback(trace, f"LLM 归因失败：{e}")
            time.sleep(2**attempt)

def classify_batch(traces: list[dict], sleep_between=0.2, on_progress=None):
    results=[]
    for i,t in enumerate(tqdm(traces, desc="LLM 统一归因")):
        r=classify_single(t); results.append(r)
        if on_progress: on_progress(i+1,len(traces),r)
        time.sleep(sleep_between)
    return results

if __name__ == "__main__":
    p=argparse.ArgumentParser(); p.add_argument("--input",default="./output/raw_badcases.json"); p.add_argument("--output",default="./output/classified_badcases.json"); p.add_argument("--test",action="store_true"); a=p.parse_args()
    with open(a.input,encoding="utf-8") as f: traces=json.load(f)
    if a.test: traces=random.sample(traces,min(5,len(traces)))
    results=classify_batch(traces)
    if a.test:
        print(json.dumps(results,ensure_ascii=False,indent=2))
    else:
        os.makedirs(os.path.dirname(a.output) or ".",exist_ok=True)
        with open(a.output,"w",encoding="utf-8") as f: json.dump(results,f,ensure_ascii=False,indent=2)
        print(f"保存 {len(results)} 条结果到 {a.output}")
