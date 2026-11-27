"""Turn internal cause codes into developer-actionable issue statements."""
from __future__ import annotations
import re

def _t(v):return str(v or '')
def developer_issue(category,rep):
 cat=_t(category);failure=_t(rep.get('failure_output'));tool=_t(rep.get('failed_tool'));summary=_t(rep.get('trace_summary'));alltext=' '.join([failure,tool,summary]).lower()
 if cat=='tool_execution_failed':
  if 'analyzevisualmedia' in tool.lower() or 'visual understanding request failed' in alltext:
   return {'name':'视觉理解工具执行失败','module_id':'L6.1','module_name':'ToolExecutionService','description':'analyzeVisualMedia 接收到有效调用后返回 Visual understanding request failed，首次异常发生在工具执行节点；Agent 连续重试、降级较晚属于后续 L2.2 编排改进项。','fix':'先修复或明确诊断视觉理解工具的执行失败；同时为连续失败增加熔断阈值并及时切换可用降级路径。'}
  if 'unexpected token' in alltext or '<html' in alltext:
   return {'name':'工具端点返回非 JSON 导致执行失败','module_id':'L6.1','module_name':'ToolExecutionService','description':'工具端点返回 HTML/非 JSON，最早异常发生在工具结果解析和执行节点；后续未快速降级是次要编排问题。','fix':'在工具结果入口校验 Content-Type 和 JSON 结构，保留原始响应并按错误类型触发替代路径。'}
  return {'name':'工具执行失败','module_id':'L6.1','module_name':'ToolExecutionService','description':'工具调用已发出，但工具执行或结果处理返回失败；恢复策略问题仅作为后续编排观察项。','fix':'在 ToolExecutionService 保留明确失败类型与原始输出，并为上层提供可重试性和替代能力信号。'}
 if cat=='model_parameter_missing':return {'name':'模型请求未携带必填 model 参数','module_id':'L5.2','module_name':'ModelParamsResolver','description':'Provider 明确返回 No model specified，请求在参数解析或合并阶段丢失 model。','fix':'发送前强制校验 model，并记录参数来源和覆盖链路。'}
 if cat=='thinking_parameter_type_invalid':return {'name':'thinking 参数被错误转换为对象类型','module_id':'L5.7','module_name':'Parameter Resolver','description':'请求将 thinking 传为 map/object，但目标 Provider 只接受 boolean。','fix':'按 Provider/Model 能力表标准化 thinking，并在发送前执行字段级 Schema 校验。'}
 if cat=='tool_validation_error':
  if 'sheet-id' in alltext or 'sheet-name' in alltext:return {'name':'调用表格工具时遗漏必填工作表标识','module_id':'L2.2','module_name':'GeneralChatAgent','description':'工具明确要求 sheet-id 或 sheet-name，但 Agent 首次调用未提供。','fix':'从前序结果提取工作表标识；调用前按工具 Schema 检查必填参数。'}
  if 'unknown command' in alltext:return {'name':'工具命令名选择错误','module_id':'L2.2','module_name':'GeneralChatAgent','description':'Agent 调用了不存在的命令，工具返回可用命令提示后才纠正。','fix':'调用前基于当前工具清单校验命令名，并优先使用工具返回的建议命令。'}
  return {'name':'工具调用前缺少必填参数校验','module_id':'L2.2','module_name':'GeneralChatAgent','description':'工具参数或类型不满足契约，首次调用被校验层拒绝。','fix':'调用前按 Tool Schema 做必填字段和类型校验。'}
 if cat=='tool_unavailable':
  if 'sandbox' in alltext or 'disabled' in alltext:return {'name':'未根据运行环境过滤不可用工具','module_id':'L4.6','module_name':'Tools 段引擎','description':'运行环境已禁用 Cloud Sandbox，但工具仍被暴露或被 Agent 选择。','fix':'构建工具清单时按运行环境过滤不可用工具，并向 Agent 暴露替代能力。'}
  return {'name':'不可用工具仍进入 Agent 候选清单','module_id':'L4.6','module_name':'Tools 段引擎','description':'Agent 选择了当前环境不可用的工具，之后才回退。','fix':'按平台、权限和运行环境动态裁剪工具清单。'}
 return {'name':cat,'module_id':rep.get('module_id',''),'module_name':rep.get('module_name',''),'description':rep.get('reason',''),'fix':'结合 Trace 证据修复对应编排模块。'}
