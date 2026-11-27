"""Evidence-first main attribution review following SKILL.md principles."""
from __future__ import annotations
import json,re

def t(v):return str(v or '')
def validate(category,rep,dev_issue):
 failure=t(rep.get('failure_output'));tool=t(rep.get('failed_tool'));summary=t(rep.get('trace_summary'));alltext=' '.join([failure,tool,summary]).lower();candidates=[];basis=''
 # 1) Direct Tool Result failure after a syntactically valid Tool Call.
 if failure.strip() and tool.strip():
  main='L6.1';basis='Tool Call 已正常发出且 Tool Result 直接返回失败；最早异常在工具执行/结果处理节点'
  if 'disabled' in alltext and ('sandbox' in alltext or 'runcommand' in tool.lower()):
   main='L4.6';basis='运行环境明确禁用该能力，但工具仍出现在候选清单并被调用；异常在工具暴露阶段已产生';candidates=['L6.2']
  elif any(x in alltext for x in ['unknown command','specify at least one','required;','invalid_argument']):
   main='L2.2';basis='工具在执行前即按契约拒绝 Agent 生成的命令/参数；异常参数最早由 Agent 决策生成';candidates=['L6.1']
  elif 'analyzevisualmedia' in tool.lower() or 'visual understanding request failed' in alltext:
   main='L6.1';basis='视觉工具收到有效 question/refs 后直接返回执行失败';candidates=['L2.2']
  elif 'unexpected token' in alltext or '<html' in alltext:
   main='L6.1';basis='工具结果为非 JSON，失败在 ToolExecutionService 结果解析节点直接暴露';candidates=['L6.3','L6.4']
  return main,basis,candidates
 # 2) Provider field-level rejection reveals earliest malformed payload producer.
 if category=='model_parameter_missing':return 'L5.2','Provider 明确指出缺少必填 model；异常请求最早在 ModelParamsResolver 参数合并阶段形成',[]
 if category=='thinking_parameter_type_invalid':return 'L5.7','Provider 明确指出 thinking 实际为 map、期望 boolean；异常值最早在 Parameter Resolver 转换阶段形成',['L5.2']
 return dev_issue['module_id'],'沿用已分类证据；当前没有更早的直接异常节点证据',[]
