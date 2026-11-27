"""固定 8 层 56 模块的开发可解决性先验与统一开发优先级计算。

归因树决定“问题在哪”；本模块决定“Agent 开发老师能否从代码角度解决、值得多优先”。
频率只占 10%，不能让高频外部错误压过低频但明确可修复的内部源码问题。
"""
from __future__ import annotations
import json,math,re
from taxonomy import get_flat_modules

# 0-100：开发人员通过修改 TripYoYo / Agent 代码解决该模块问题的先验可能性。
MODULE_DEVELOPMENT_PRIORITY={
 'L1.1':78,'L1.2':80,'L1.3':88,
 'L2.1':100,'L2.2':82,'L2.3':95,'L2.4':88,'L2.5':100,
 'L3.1':100,'L3.2':98,'L3.3':98,'L3.4':88,'L3.5':85,
 'L4.1':98,'L4.2':98,'L4.3':100,'L4.4':100,'L4.5':100,'L4.6':95,'L4.7':95,
 'L5.1':95,'L5.2':100,'L5.3':65,'L5.4':100,'L5.5':100,'L5.6':92,'L5.7':100,'L5.8':85,'L5.9':95,
 'L6.1':50,'L6.2':72,'L6.3':30,'L6.4':40,'L6.5':20,'L6.6':35,'L6.7':20,'L6.8':90,
 'L7.1':75,'L7.2':82,'L7.3':95,'L7.4':100,'L7.5':98,'L7.6':72,'L7.7':60,'L7.8':25,'L7.9':85,'L7.10':45,
 'L8.1':70,'L8.2':30,'L8.3':0,'L8.4':55,'L8.5':50,'L8.6':10,'L8.7':45,'L8.8':20,'L8.9':90,
}

MODULE_GROUP={
 **{x:'P0_CORE_AGENT_SOURCE' for x in ['L2.1','L2.3','L2.5','L3.1','L3.2','L3.3','L4.1','L4.2','L4.3','L4.4','L4.5','L4.6','L4.7','L5.1','L5.2','L5.4','L5.5','L5.6','L5.7','L5.8','L5.9','L7.3','L7.4','L7.5','L8.9']},
 **{x:'P1_INTERNAL_PLATFORM' for x in ['L1.1','L1.2','L1.3','L2.2','L2.4','L3.4','L3.5','L5.3','L6.2','L6.8','L7.1','L7.2','L7.6','L7.9','L8.1']},
 **{x:'P2_MIXED_BOUNDARY' for x in ['L6.1','L6.3','L6.4','L6.6','L7.7','L7.10','L8.2','L8.4','L8.5','L8.7']},
 **{x:'P3_EXTERNAL_OR_ENV' for x in ['L6.5','L6.7','L7.8','L8.6']},
 'L8.3':'G_ATTRIBUTION_GOVERNANCE','L8.8':'G_EVAL_GOVERNANCE',
}

HARD_EXCLUDED_ACTIONABILITY={'non_orchestration_dependency','external_uncontrollable','attribution_governance','external_dependency','user_or_business_input','non_code_configuration'}
INTERNAL_STRONG_CATEGORIES={'context_window_exceeded','provider_bad_request','thinking_parameter_type_invalid','empty_message_content_block','tool_arguments_stream_assembly_failed','successful_tool_result_not_consumed','pending_tool_state_not_resumed','subtask_completion_not_resumed','terminal_state_not_emitted','builtin_tool_contract_invalid','builtin_tool_unavailable','builtin_result_parse_failed'}
EXTERNAL_OR_MISSING_RE=re.compile(r'mcp|tool result|sql execution failed|gateway|provider.*(?:timeout|quota|permission)|credential|用户电脑|本地环境',re.I)

IMPACT_SCORE={'runtime_error':100,'hard_failed':100,'quality_badcase':80,'performance_badcase':60,'recovered_with_capability_issue':40,'eval_badcase':30,'observability_gap':0}

def clamp(v):return max(0.0,min(100.0,float(v)))
def truth(v):
 if isinstance(v,bool):return v
 if v is None:return False
 if isinstance(v,float) and math.isnan(v):return False
 return str(v).strip().lower() not in {'','0','false','none','nan','[]','{}'}
def parse_ids(v):
 if isinstance(v,list):return v
 if not truth(v):return []
 try:
  x=json.loads(v);return x if isinstance(x,list) else []
 except:return [x.strip() for x in str(v).split(',') if x.strip()]

def evidence_score(row):
 """内部证据完整度 0-100；只有外部 Error/关键词时保持低分。"""
 score=10.0
 internal_node=row.get('first_internal_abnormal_node_id') or row.get('first_abnormal_node_id')
 evidence_ids=parse_ids(row.get('internal_evidence_node_ids') or row.get('root_cause_evidence_node_ids'))
 counterfactual=row.get('counterfactual_fix')
 context=' '.join(str(row.get(k,'') or '') for k in ['context','attribution_basis','reason','signal','abnormal_input_source'])
 if truth(internal_node):score+=30
 if evidence_ids:score+=20
 if truth(counterfactual):score+=20
 if re.search(r'实际值|期望值|expected|actual|invalid type|maximum context|payload|字段|类型转换|拼接',context,re.I):score+=15
 if truth(row.get('attribution_basis')):score+=10
 # 当前导出适配器若能明确落到 L4/L5 内部字段机制，可视为可反推内部节点，但不满分。
 if str(row.get('module_id','')).startswith(('L3','L4','L5')) and str(row.get('category','')) in INTERNAL_STRONG_CATEGORIES:score=max(score,82)
 # 调用前仍保留模板变量、或参数被契约直接拒绝，属于可从下游错误唯一反推的内部输入缺陷。
 if str(row.get('category','')) in {'sql_unreplaced_variable','tool_validation_error','builtin_tool_contract_invalid'}:score=max(score,70)
 if EXTERNAL_OR_MISSING_RE.search(context) and not truth(internal_node) and str(row.get('category','')) not in {'sql_unreplaced_variable','tool_validation_error'}:score=min(score,35)
 if str(row.get('module_id','')).startswith('L6') and not truth(internal_node):score=min(score,30)
 return clamp(score)

def actionability_score(row):
 mid=str(row.get('module_id',''));score=float(MODULE_DEVELOPMENT_PRIORITY.get(mid,50));cat=str(row.get('category',''));action=str(row.get('actionability',''));context=' '.join(str(row.get(k,'') or '') for k in ['context','attribution_basis','signal','abnormal_input_source'])
 # 产品口径：MCP/Plugin/未知来源 Tool 一律按外部原因，不参与 Agent 源码优先级。
 if str(row.get('tool_source','')).lower() in {'mcp','plugin','unknown'}:return 0.0
 if action in HARD_EXCLUDED_ACTIONABILITY:return 0.0
 # 明确内部源码机制提权。
 if cat in INTERNAL_STRONG_CATEGORIES:score+=10
 if truth(row.get('first_internal_abnormal_node_id') or row.get('first_abnormal_node_id')):score+=8
 if truth(row.get('counterfactual_fix')):score+=7
 # 外部边界、SQL、用户/环境来源不明降权。
 if (str(mid).startswith('L6') or cat.startswith('sql_') or 'tool' in cat) and str(row.get('tool_source','')).lower()!='builtin':score-=25
 if EXTERNAL_OR_MISSING_RE.search(context):score-=15
 if re.search(r'用户明确|user_provided|用户指定',context,re.I):score-=30
 # 工具调用前已明确生成错误数据，可适度补偿，但不能超过核心内部模块。
 if cat in {'sql_unreplaced_variable','tool_validation_error','builtin_tool_contract_invalid'}:score+=12
 if mid in {'L8.3','L8.8'}:return 0.0
 return clamp(score)

def impact_score(row):return float(IMPACT_SCORE.get(str(row.get('badcase_kind','runtime_error')),50))
def frequency_score(topic_count,max_topic_count):
 if max_topic_count<=0:return 0.0
 return clamp(100*math.log2(1+float(topic_count))/math.log2(1+float(max_topic_count)))

def calculate_priority(row,max_topic_count):
 """返回统一四维分及开发榜资格。总分 0-100。"""
 a=actionability_score(row);e=evidence_score(row);i=impact_score(row);f=frequency_score(row.get('trace_count',0),max_topic_count)
 total=round(.45*a+.30*e+.15*i+.10*f,2)
 action=str(row.get('actionability',''));mid=str(row.get('module_id',''))
 excluded=action in HARD_EXCLUDED_ACTIONABILITY or mid in {'L8.3','L8.8'} or str(row.get('tool_source','')).lower() in {'mcp','plugin','unknown'}
 # P2/P3 边界模块必须达到更高证据门槛；内部模块也不能只有关键词证据。
 group=MODULE_GROUP.get(mid,'P2_MIXED_BOUNDARY');threshold=70 if group.startswith('P2') else (80 if group.startswith('P3') else 45)
 eligible=(not excluded) and a>=threshold and e>=30
 return {'development_score':total,'actionability_score':round(a,2),'evidence_score':round(e,2),'impact_score':round(i,2),'frequency_score':round(f,2),'module_prior':MODULE_DEVELOPMENT_PRIORITY.get(mid,50),'priority_group':group,'eligible_for_dev_ranking':eligible}

def validate_config():
 modules={x['module_id'] for x in get_flat_modules()};assert set(MODULE_DEVELOPMENT_PRIORITY)==modules,(modules-set(MODULE_DEVELOPMENT_PRIORITY),set(MODULE_DEVELOPMENT_PRIORITY)-modules);assert set(MODULE_GROUP)==modules;return True
if __name__=='__main__':validate_config();print('development priority ok: 56 modules')
