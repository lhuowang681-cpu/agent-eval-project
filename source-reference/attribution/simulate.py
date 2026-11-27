"""无 Langfuse/LLM 凭证的离线端到端演示。"""
import json, os, random
from taxonomy import get_module_by_id, validate_taxonomy
from aggregator import load_classified, aggregate, save_csv, print_summary
from visualizer import chart1_error_category, chart2_module_distribution

random.seed(42); validate_taxonomy(); os.makedirs("./output",exist_ok=True)
CASES=[
("missing_tool_call","缺少工具调用","L2.2",18),
("stream_end_missing","缺少流结束事件","L3.2",15),
("tool_arguments_stream_assembly_failed","工具参数流拼接失败","L5.5",13),
("context_window_misconfigured","上下文窗口配置错误","L5.8",11),
("tool_executor_not_found","工具执行器缺失","L6.1",10),
("mcp_server_start_failed","MCP服务启动失败","L6.3",9),
("skill_catalog_missing","Skill清单缺失","L4.7",8),
("agent_document_overflow","Agent文档过大","L7.3",7),
("sub_agent_result_not_backfilled","子Agent结果未回填","L7.4",6),
("trace_span_missing","Trace与Span缺失","L8.3",5),
("openapi_sse_incompatible","OpenAPI流格式不兼容","L8.9",4),
("database_message_persistence_failed","消息落库失败","L8.1",3),
]
records=[]
for ec,zh,mid,count in CASES:
    m=get_module_by_id(mid)
    for i in range(count):
        confidence=round(random.uniform(.62,.98),2)
        records.append({"trace_id":f"demo-{mid}-{i}","trace_name":"demo_badcase","trace_timestamp":"2026-07-24T00:00:00Z","badcase_kind":"observability_gap" if mid=="L8.3" else "runtime_error","error_category":ec,"error_category_zh":zh,"original_error_type":"","error_phase":"","layer_id":m["layer_id"],"layer_name":m["layer_name"],"module_id":mid,"module_name":m["name"],"confidence":confidence,"needs_review":confidence<.72 or mid=="L8.3","evidence":[f"仿真证据：{zh}"],"reason":"仿真数据，仅用于验证统计与图表","candidate_modules":[]})
with open("./output/classified_badcases.json","w",encoding="utf-8") as f: json.dump(records,f,ensure_ascii=False,indent=2)
df=load_classified(); a,b=aggregate(df); print_summary(a,b); save_csv(a,b,source_df=df)
chart1_error_category(a); chart2_module_distribution(b)
print(f"仿真完成：{len(records)} 条，生成两张核心图表")
