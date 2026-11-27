from pathlib import Path
import json,re
import pandas as pd
from openpyxl import Workbook,load_workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.utils import get_column_letter
from trace_denoiser import denoise_trace_nodes
P=Path(r"D:\Users\martinma\Downloads\TripYoYo_Error_Traces_20260720_20260727.xlsx");OUT=Path('output/review_samples_v2');OUT.mkdir(parents=True,exist_ok=True)
R=pd.read_excel(P,sheet_name='RAW_NODES');E=pd.read_excel(P,sheet_name='ERROR_EVENTS')
CASES=[
 {'no':1,'tid':'tpc_A6iVTYMRUrW0','l1':'模型运行错误','l2':'流式连接中断','layer':'L5 Model Runtime 层','module':'L5.5 Stream Processors','root':'Assistant / Model 流式响应节点','exposure':'Assistant / Model 流式响应节点','function':'Provider Stream Processor / 流式 fetch（具体函数待确认）','confidence':'高（0.95）','conclusion':'Stream Processors 在模型流式响应期间发生 network error，导致 ConnectionAborted，用户请求未获得可用结果。','impact':'任务中断；模型没有产出可用结果，用户无法获得所需 Excel 预测。','fix':['区分客户端 Abort 与上游 network error；非用户主动中止时明确失败或安全重连。','保留最后成功 Chunk；重试前校验幂等；部分输出不得标为成功。','监控关闭方、最后 Chunk、持续时间和重试结果；补充断流集成测试。']},
 {'no':2,'tid':'tpc_xRRBwNDCOUVp','l1':'凭证与权限错误','l2':'Provider 凭证绑定缺失','layer':'L8 横切关注点','module':'L8.6 Credentials 管理','root':'推断根因节点：Credentials 凭证绑定查询/注入节点','exposure':'Assistant / Model 调用节点','function':'Peta Auth bindKey / petaKeyId 绑定查询接口','confidence':'高（0.98）','conclusion':'Credentials 管理未找到 appId 与 keyName 的绑定关系，模型调用被 PetaAuthError 拒绝，任务直接失败。','impact':'任务中断；连续两次用户请求均未获得模型回答。','fix':['补齐 appId-keyName 绑定；启动时校验 petaKeyId 与授权关系。','模型调用前执行凭证预检；保留 PetaAuthError，不只包装为 500。','监控 missing binding；增加凭证初始化、轮换和失效测试。']},
 {'no':3,'tid':'tpc_2uc7jGBkl5ux','l1':'模型请求参数错误','l2':'Thinking 参数类型错误','layer':'L5 Model Runtime 层','module':'L5.7 Parameter Resolver','root':'推断根因节点：Parameter Resolver 的 thinking 参数转换节点','exposure':'Assistant / Model 请求节点','function':'thinking 参数解析与 Provider Payload 序列化；字段 thinking','confidence':'高（0.99）','conclusion':'Parameter Resolver 将 thinking 传为 map，而目标 Provider 只接受 boolean，导致请求反序列化失败，用户任务未执行。','impact':'任务中断；Provider 在生成前拒绝请求，没有可用回答。','fix':['按 Provider/Model 能力表将 thinking 规范化为 boolean，或移除不支持参数。','发送前执行 JSON Schema 校验；参数异常时返回明确客户端错误。','增加 Provider 的 thinking 参数契约测试和字段级告警。']}
]
BLUE='1F4E78';WHITE='FFFFFF';LIGHT='D9EAF7';ROOT='FEE4E2';EXPOSE='FEF0C7';PROP='F2F4F7';FINAL='FDECEC'
def clean(v,n=None):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 s=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',str(v))).strip()
 # Source systems sometimes persist literal placeholders instead of model output.
 if s.lower() in {'...','…','nan','null','none'}:return ''
 return s if n is None else s[:n]
def parse_error(raw):
 try:d=json.loads(raw) if isinstance(raw,str) else {}
 except:d={}
 vals=[]
 def walk(x):
  if isinstance(x,dict):
   for k,v in x.items():
    if k.lower() in {'type','name','code','status','message','reason','provider','endpoint'} and not isinstance(v,(dict,list)):vals.append(f'{k}: {v}')
    elif isinstance(v,(dict,list)):walk(v)
 walk(d);return ' | '.join(dict.fromkeys(vals))[:1600]
def role_label(role,tools):
 if role=='user':return 'User'
 if role=='assistant' and pd.notna(tools) and str(tools) not in {'','nan'}:return 'Assistant / Model → Tool Call'
 if role=='assistant':return 'Assistant / Model'
 if role=='tool':return 'Tool Output / Observation'
 return 'Agent / Workflow' if role in {'task','agent'} else 'System'
def tool_input(v):
 if pd.isna(v) or str(v) in {'','nan'}:return ''
 try:
  x=json.loads(v); item=x[0] if isinstance(x,list) and x else x
  if isinstance(item,dict):return clean(item.get('arguments') or item.get('args') or item,500)
 except:pass
 return clean(v,500)
def build_evidence(c,g,eg):
 root_ids=set(eg.id.dropna().astype(str)); parent_ids=set(eg.parent_id.dropna().astype(str)); first_err=eg.iloc[0]; last_err=eg.iloc[-1]
 rows=[]
 user=g[g.role.eq('user')].head(1)
 if len(user):rows.append({'kind':'上下文','role':'User','caller':'User → Assistant / Model','input':clean(user.iloc[0].content),'output':'','abnormal':'','effect':'定义用户任务'})
 # parent nodes and error nodes
 selected=g[g.id.astype(str).isin(root_ids|parent_ids)].sort_values('created_at')
 for _,n in selected.iterrows():
  iserr=bool(n.is_error) or str(n.id) in root_ids
  role=role_label(n.role,n.tools); caller='User → Assistant / Model' if n.role=='assistant' else ('Assistant / Model → Tool' if n.role=='tool' else 'Agent / Workflow')
  inp=tool_input(n.tools) if n.role=='assistant' else ''
  out=clean(n.content) if n.role in {'tool','assistant'} else ''
  err=parse_error(n.error)
  if iserr and not out:
   out='源数据无有效模型输出'
  rows.append({'kind':'报错节点' if iserr else '关键上游','role':role,'caller':caller,'input':inp,'output':out,'abnormal':err or ('错误由下游节点暴露' if not iserr else ''),'effect':'直接暴露失败' if iserr else '向报错节点提供输入/上下文'})
 # If root is not explicitly observed, add inferred root row before exposure.
 if c['root'].startswith('推断根因节点'):
  if c['no']==2:
   inferred_input='appId + keyName / petaKeyId（具体原值未记录）'
   inferred_output='凭证绑定不存在；Provider 返回 No binding found，要求 bindKey'
   inferred_basis='PetaAuthError 同时给出鉴权对象、绑定缺失和修复动作，可直接反推绑定查询/注入节点异常'
  else:
   inferred_input='thinking = map/object（具体 Payload 未完整记录）'
   inferred_output='目标 Provider 期望 boolean，Payload 反序列化失败'
   inferred_basis='字段级错误明确指出 thinking 的实际类型与期望类型，可直接反推参数转换节点异常'
  rows.insert(1,{'kind':'推断根因节点','role':'Agent / Workflow','caller':c['module'],'input':inferred_input,'output':inferred_output,'abnormal':inferred_basis,'effect':'生成了被下游 Provider 明确拒绝的异常状态；节点为逻辑反推，非独立 Span'})
 # final failed node
 last=g.iloc[-1]
 rows.append({'kind':'最终失败','role':role_label(last.role,last.tools),'caller':'上游错误 → 最终节点','input':'','output':clean(last.content) or parse_error(last.error) or '无可用结果','abnormal':'Trace 最终节点为失败，未发现成功恢复输出','effect':c['impact']})
 return rows
def add_case_rules_sheet(wb,c,den):
 name=f"CASE_{c['no']:02d}_RULES";ws=wb.create_sheet(name);ws.column_dimensions['A'].width=24;ws.column_dimensions['B'].width=100
 ws.append(['去噪统计','数据'])
 stats=[('原始节点数',den['stats']['raw_nodes']),('去重后节点数',den['stats']['deduplicated_nodes']),('保留证据节点数',den['stats']['retained_nodes']),('移除节点数',den['stats']['removed_nodes']),('错误节点数',den['stats']['error_nodes'])]
 for x in stats:ws.append(x)
 ws.append(['去噪规则','说明'])
 rules=[('节点去重','相同 node_id 仅保留最后一条记录'),('移除展示噪音','移除系统指令、工具 Manifest、Base64/Data URI；超长内容显式截断'),('保留错误节点','所有 is_error/Error Body 节点保留'),('保留父链','保留错误节点至根节点的 Parent 祖先链'),('保留错误时间窗口','保留错误节点前后相邻节点'),('保留直接子节点','保留错误节点的直接 Child 节点'),('保留关键角色','保留报错前最近的 User、Assistant、Tool、Task'),('审计口径',f"CASE_{c['no']:02d}_TRACE_AUDIT 每行是证据节点，不是一轮对话或模型调用")]
 for x in rules:ws.append(x)
 for rowno in [1,7]:
  for cell in ws[rowno]:cell.fill=PatternFill('solid',fgColor=BLUE);cell.font=Font(color=WHITE,bold=True)
 ws.freeze_panes='A2'
 return ws

def add_case_trace_audit_sheet(wb,c,den):
 name=f"CASE_{c['no']:02d}_TRACE_AUDIT";ws=wb.create_sheet(name)
 heads=['证据节点序号','created_at','role','is_error','retention_reason','provider','model','error_type','error_message','error_detail','content','reasoning','tool_names','tool_signals'];ws.append(heads)
 for i,n in enumerate(den['nodes'],1):
  ws.append([i,n['created_at'],n['role'],n['is_error'],json.dumps(n['retention_reason'],ensure_ascii=False),n['provider'],n['model'],n['error_type'],n['error_message'],n['error_detail'],n['content'],n['reasoning'],json.dumps(n['tool_names'],ensure_ascii=False),json.dumps(n['tool_signals'],ensure_ascii=False)])
 for cell in ws[1]:cell.fill=PatternFill('solid',fgColor=BLUE);cell.font=Font(color=WHITE,bold=True)
 ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
 widths=[12,21,15,10,28,16,24,22,38,55,55,45,30,55]
 for i,w in enumerate(widths,1):ws.column_dimensions[get_column_letter(i)].width=w
 return ws

wb=Workbook();wb.remove(wb.active);overview=wb.create_sheet('SAMPLE_OVERVIEW');overview.append(['Case','错误一级类别','错误二级类别','Topic ID','Trace 时间','能力层','具体模块','置信度'])
for x in overview[1]:x.fill=PatternFill('solid',fgColor=BLUE);x.font=Font(color=WHITE,bold=True)
ev_all=[];tech=[]
for c in CASES:
 g=R[R.effective_trace_id.eq(c['tid'])].sort_values('created_at').drop_duplicates('id',keep='last');eg=E[E.effective_trace_id.eq(c['tid'])].sort_values('created_at');err=eg.iloc[-1];topic=next((str(x) for x in g.topic_id.dropna() if str(x).strip()),'待确认');user=g[g.role.eq('user')].head(1);task=clean(user.iloc[0].content if len(user) else '') or '用户任务待确认'
 overview.append([c['no'],c['l1'],c['l2'],topic,str(err.created_at),c['layer'],c['module'],c['confidence']])
 sh=wb.create_sheet(f"CASE_{c['no']:02d}");sh.sheet_view.showGridLines=False;sh.sheet_view.zoomScale=80
 for col,w in {'A':18,'B':22,'C':24,'D':27,'E':34,'F':34,'G':38}.items():sh.column_dimensions[col].width=w
 sections=[('1. Case 标识',[('错误类别',f"{c['l1']} / {c['l2']}"),('Case 序号',c['no']),('Topic ID',topic),('Trace 时间',str(err.created_at))]),('2. 一句话结论',[('结论',c['conclusion'])]),('3. 用户任务',[('任务',task)]),('4. 最终影响',[('影响',c['impact'])]),('5. 根因定位',[('根因节点',c['root']),('报错节点',c['exposure']),('能力层',c['layer']),('具体模块',c['module']),('可能的函数/接口',c['function']),('归因置信度',c['confidence'])]),('6. 错误证据',[('错误信息',clean(err.error_message) or 'error_message 为空'),('Error Detail',parse_error(err.error_raw))]),('7. 精简调用链',[('调用链',f"用户请求 → 模型决策 → {c['root']} → {c['exposure']} → 最终失败")]),('8. 修复建议',[('立即修复',c['fix'][0]),('防御性处理',c['fix'][1]),('监控与测试补充',c['fix'][2])]),('9. 软错误观察项',[('观察项','未发现与当前失败无关且已恢复的软错误')])]
 row=1
 for title,items in sections:
  sh.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);cell=sh.cell(row,1,title);cell.fill=PatternFill('solid',fgColor=BLUE);cell.font=Font(color=WHITE,bold=True,size=13);sh.row_dimensions[row].height=24;row+=1
  for k,v in items:
   sh.merge_cells(start_row=row,start_column=1,end_row=row,end_column=2);sh.cell(row,1,k);sh.cell(row,1).fill=PatternFill('solid',fgColor=LIGHT);sh.cell(row,1).font=Font(bold=True)
   sh.merge_cells(start_row=row,start_column=3,end_row=row,end_column=7);sh.cell(row,3,v);sh.row_dimensions[row].height=max(24,min(90,18+len(str(v))//55*15));row+=1
  row+=1
 # Human-readable evidence table
 sh.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);sh.cell(row,1,'Trace 证据链');sh.cell(row,1).fill=PatternFill('solid',fgColor=BLUE);sh.cell(row,1).font=Font(color=WHITE,bold=True,size=13);row+=1
 headers=['顺序','节点性质','角色','谁调用了谁','关键输入','关键输出 / Error Detail','支持的判断'];
 for j,h in enumerate(headers,1):sh.cell(row,j,h);sh.cell(row,j).fill=PatternFill('solid',fgColor=LIGHT);sh.cell(row,j).font=Font(bold=True)
 row+=1;evidence=build_evidence(c,g,eg)
 for idx,x in enumerate(evidence,1):
  # Error Detail has higher diagnostic value than placeholder/no model output.
  diagnostic_output=x['abnormal'] if x['kind']=='报错节点' and x['abnormal'] else (x['output'] or x['abnormal'])
  vals=[idx,x['kind'],x['role'],x['caller'],x['input'],diagnostic_output,x['effect']]
  for j,v in enumerate(vals,1):sh.cell(row,j,v)
  fill=ROOT if '根因' in x['kind'] else (EXPOSE if x['kind']=='报错节点' else (FINAL if x['kind']=='最终失败' else 'FFFFFF'))
  for j in range(1,8):sh.cell(row,j).fill=PatternFill('solid',fgColor=fill)
  sh.row_dimensions[row].height=max(30,min(105,25+max(len(str(v)) for v in vals)//60*15));row+=1
  ev_all.append({'case_no':c['no'],'topic_id':topic,'trace_id':c['tid'],'seq':idx,**x})
 # Per-case trace analysis: copy the reference workbook's RULES + TRACE_AUDIT structure.
 # Keep these two sheets immediately after the corresponding CASE sheet.
 den=denoise_trace_nodes(g.to_dict('records'),max_nodes=40)
 add_case_rules_sheet(wb,c,den)
 add_case_trace_audit_sheet(wb,c,den)
 # Technical ids in audit only
 for _,n in g.iterrows():tech.append({'case_no':c['no'],'topic_id':topic,'trace_id':c['tid'],'time':n.created_at,'role':n.role,'node_id':n.id,'parent_id':n.parent_id,'is_error':n.is_error,'error':n.error})
# Unified evidence
tev=wb.create_sheet('TRACE_EVIDENCE');eh=['case_no','topic_id','trace_id','seq','kind','role','caller','input','output','abnormal','effect'];tev.append(eh)
for x in ev_all:tev.append([x.get(k) for k in eh])
# Soft observations
soft=wb.create_sheet('SOFT_ERROR_OBSERVATIONS');soft.append(['Topic ID','候选异常','恢复证据','正式 Badcase 计数']);soft_rows=[('tpc_ko3VK8a6JpMj','ConnectionAborted / network error','错误后继续执行并输出最终结果','不计入'),('tpc_F6fWMR6R562H','thinking 参数错误','后续搜索工具成功并生成最终回答','不计入')]
for x in soft_rows:soft.append(x)
# Tech audit
ad=wb.create_sheet('TECH_AUDIT');ah=['case_no','topic_id','trace_id','time','role','node_id','parent_id','is_error','error'];ad.append(ah)
for x in tech:ad.append([x.get(k) for k in ah])
for ws in [tev,soft,ad]:
 for c in ws[1]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
 ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
for ws in wb.worksheets:
 ws.sheet_view.showVerticalScroll=True;ws.sheet_view.showHorizontalScroll=True
 for rr in ws.iter_rows():
  for cc in rr:cc.alignment=Alignment(vertical='top',wrap_text=True)
 if ws.title in {'SAMPLE_OVERVIEW','TRACE_EVIDENCE','SOFT_ERROR_OBSERVATIONS','TECH_AUDIT'}:
  for col in ws.columns:
   vals=list(col);ws.column_dimensions[get_column_letter(vals[0].column)].width=min(45,max(12,max(len(str(x.value or '')) for x in vals[:300])+2))
out=OUT/'three_case_review_samples_inferred_root.xlsx';wb.save(out);print(json.dumps({'excel':str(out),'case_count':3,'evidence_rows':len(ev_all),'soft_observations':len(soft_rows),'tech_rows':len(tech)},ensure_ascii=False,indent=2))
