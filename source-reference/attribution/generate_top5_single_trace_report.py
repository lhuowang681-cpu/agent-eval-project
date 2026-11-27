from pathlib import Path
import json,re
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.utils import get_column_letter
from openpyxl.drawing.image import Image as XLImage
from PIL import Image as PILImage
import matplotlib
import matplotlib.pyplot as plt
from trace_denoiser import denoise_trace_nodes
from cause_convergence import converge
from developer_issue_labels import developer_issue
from reattribution_validator import validate as validate_attribution
ROOT=Path(__file__).resolve().parent
SRC=Path(r'D:\Users\martinma\Downloads\TripYoYo_Error_Traces_20260720_20260727.xlsx')
CLASSIFIED=ROOT/'output/real_analysis/classified_badcases.json';OUTCOME=ROOT/'output/trace_outcome_audit.csv';SOFT=ROOT/'output/capability_issue_analysis/soft_errors/soft_error_details.csv';SCENE=ROOT/'output/scenario_analysis/scenario_issue_details.csv';OUT=ROOT/'output/single_trace_convergence';OUT.mkdir(parents=True,exist_ok=True)
BLUE='1F4E78';WHITE='FFFFFF';LIGHT='D9EAF7';RED='FEE4E2';YELLOW='FFF1CC'
def v(x):return '' if x is None or (isinstance(x,float) and pd.isna(x)) else str(x)
def compact(x,n=1800):s=re.sub(r'\s+',' ',v(x)).strip();return s if len(s)<=n else s[:n]+f'…[TRUNCATED:{len(s)-n}]'
def header(ws,row=1):
 for c in ws[row]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
def actionability(cat,mid,reason):
 ext={'stream_connection_aborted','provider_gateway_timeout','provider_rate_limited','mcp_oauth_token_expired','provider_content_safety_rejected'};dep={'subscription_budget_limit_reached','provider_credential_binding_missing','provider_model_permission_denied','coding_plan_unavailable','model_not_found','insufficient_quota'}
 if mid=='L8.3' or cat=='unclassified_runtime_error':return '归因治理'
 if cat in ext or re.search(r'network error|econnreset|gateway|upstream timeout|rate.?limit|engine overloaded',reason,re.I):return '外部不可控'
 if cat in dep or mid in {'L2.4','L8.2','L8.6'} or re.search(r'预算|费用上限|quota|credential|凭证|permission|权限|api key',reason,re.I):return '非编排依赖'
 return 'Agent 编排内可解决'
def add_audit(wb,no,den):
 ws=wb.create_sheet(f'CASE_{no:02d}_TRACE_AUDIT');keys=['created_at','role','is_error','retention_reason','provider','model','error_type','error_message','error_detail','content','reasoning','tool_names','tool_signals'];ws.append(['证据节点序号']+keys)
 for i,n in enumerate(den['nodes'],1):ws.append([i]+[json.dumps(n[k],ensure_ascii=False) if isinstance(n[k],(list,dict)) else n[k] for k in keys])
 header(ws);ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
 for i,w in enumerate([12,21,15,10,28,16,24,22,38,55,55,45,30,55],1):ws.column_dimensions[get_column_letter(i)].width=w
def add_rules(wb,no,den,conv,dev_issue):
 # Developer-facing RULES only explains evidence retention and why this trace is useful.
 # Numeric scoring/weights stay in convergence_audit.json and methodology docs.
 ws=wb.create_sheet(f'CASE_{no:02d}_RULES');ws.append(['去噪统计','数据'])
 for x in [('原始节点数',den['stats']['raw_nodes']),('去重后节点数',den['stats']['deduplicated_nodes']),('保留证据节点数',den['stats']['retained_nodes']),('移除节点数',den['stats']['removed_nodes']),('错误节点数',den['stats']['error_nodes'])]:ws.append(x)
 ws.append(['证据与选样说明','说明']);w=conv['winner'];rep=conv['representative']
 for x in [('具体问题',dev_issue['name']),('代表 Topic ID',rep['trace_id']),('问题覆盖面',f"影响 {w['n_sessions']} 个去重用户任务"),('选择理由','该 Trace 能完整展示问题输入、首次异常、恢复/失败结果以及开发责任模块，可直接用于定位'),('证据保留','保留错误节点、错误父链、报错前后窗口及最近的 User/Assistant/Tool/Task'),('审计口径',f"CASE_{no:02d}_TRACE_AUDIT 每行是证据节点，不是一轮对话或模型调用")]:ws.append(x)
 header(ws,1);header(ws,7);ws.column_dimensions['A'].width=28;ws.column_dimensions['B'].width=100

def evidence(ws,row,g,eg,issue,task):
 ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,'Trace 证据链');header(ws,row);row+=1;heads=['顺序','节点性质','角色','谁调用了谁','关键输入','关键输出 / Error Detail','支持的判断']
 for j,h in enumerate(heads,1):ws.cell(row,j,h).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,j,h).font=Font(bold=True)
 row+=1;rows=[['上下文','User','User → Assistant / Model',task,'','定义用户任务']]
 # For recovered tool issues, direct Tool Result evidence is stronger than unrelated
 # Error Events elsewhere in the same long-lived Topic.
 if issue.get('failure_output'):
  rows.append(['根因/报错节点','Tool Output / Observation','Assistant / Model → Tool',issue.get('failed_tool',''),compact(issue.get('failure_output'),2000),f"首次异常发生在 {issue['module_id']} {issue['module_name']} 工具执行节点"])
 else:
  rows.append(['推断根因节点','Agent / Workflow',f"{issue['module_id']} {issue['module_name']}",'异常输入/状态以证据为准',issue['reason'],'当前类别最值得优先处理问题的典型定位样本'])
  if len(eg):
   e=eg.iloc[-1];rows.append(['报错节点','Assistant / Model','上游 → 报错节点','',compact(e.error_raw or e.error_message,2000),'直接暴露失败/能力问题'])
 rows.append(['最终表现','Assistant / Model','上游错误 → 最终节点','',issue['reason'],'硬失败' if issue['impact_status']=='hard_failed' else '已恢复但存在能力问题'])
 for i,x in enumerate(rows,1):
  for j,z in enumerate([i]+x,1):ws.cell(row,j,z).fill=PatternFill('solid',fgColor=RED if x[0]=='报错节点' else (YELLOW if x[0]=='推断根因节点' else WHITE));ws.cell(row,j,z).alignment=Alignment(vertical='top',wrap_text=True)
  row+=1
# Build same problem universe as approved orchestration report
R=pd.read_excel(SRC,sheet_name='RAW_NODES').sort_values(['effective_trace_id','created_at']).drop_duplicates('id',keep='last');E=pd.read_excel(SRC,sheet_name='ERROR_EVENTS');C=pd.DataFrame(json.loads(CLASSIFIED.read_text(encoding='utf-8')));O=pd.read_csv(OUTCOME,encoding='utf-8-sig');S=pd.read_csv(SOFT,encoding='utf-8-sig');outcome=dict(zip(O.trace_id.astype(str),O.outcome));issues=[]
for _,r in C.iterrows():
 if actionability(v(r.error_category),v(r.module_id),v(r.reason))!='Agent 编排内可解决':continue
 issues.append(dict(trace_id=str(r.trace_id),category=r.error_category,category_zh=r.error_category_zh,module_id=r.module_id,module_name=r.module_name,layer_id=r.layer_id,layer_name=r.layer_name,impact_status='hard_failed' if outcome.get(str(r.trace_id))=='hard_failed' else 'recovered_with_capability_issue',confidence=r.confidence,reason=r.reason,failed_tool='',failure_output='',original_error_type=r.original_error_type,error_message='',session_key=str(r.trace_id),trace_summary=' | '.join(map(v,[r.error_category_zh,r.reason,r.original_error_type,' '.join(r.evidence if isinstance(r.evidence,list) else [])]))))
for _,r in S.iterrows():
 issues.append(dict(trace_id=str(r.trace_id),category=r.soft_error_category,category_zh=r.soft_error_category_zh,module_id=r.module_id,module_name=r.module_name,layer_id=r.layer_id,layer_name='工具执行层',impact_status='recovered_with_capability_issue',confidence=.9,reason=f"{r.failed_tool} 失败后通过 {r.recovered_by} 恢复",failed_tool=r.failed_tool,failure_output=r.failure_output,original_error_type='',error_message='',session_key=str(r.trace_id),trace_summary=' | '.join(map(v,[r.soft_error_category_zh,r.failed_tool,r.failure_output,r.recovered_by,r.replacement_tool]))))
D=pd.DataFrame(issues).drop_duplicates(['trace_id','category']);rank=D.groupby(['category','category_zh']).trace_id.nunique().reset_index(name='trace_count').sort_values(['trace_count','category'],ascending=[False,True]).head(5).reset_index(drop=True);rank['pct']=(rank.trace_count/D.trace_id.nunique()*100).round(1)
selected=[]
for no,x in rank.iterrows():
 rows=D[D.category.eq(x.category)].to_dict('records');conv=converge(rows);selected.append((no+1,x,conv))
# Reuse four approved charts from aligned workbook to keep final chart layout consistent.
wb=Workbook();wb.remove(wb.active);charts=wb.create_sheet('00_CHARTS');charts.sheet_view.showGridLines=False;charts.sheet_view.zoomScale=55
# Large readable 2x2 canvas. Physically resize PNGs and reserve generous horizontal
# and vertical gaps so Excel/WPS can show labels clearly without overlap.
for col in range(1,45):charts.column_dimensions[get_column_letter(col)].width=12
for rowno in range(1,120):charts.row_dimensions[rowno].height=18
chart_sources=[ROOT/'output/capability_issue_analysis/01_attribution_issue_top5.png',ROOT/'output/scenario_analysis/01_scenario_issue_trace_count.png',ROOT/'output/capability_issue_analysis/02_attribution_module_distribution.png',ROOT/'output/scenario_analysis/02_scenario_issue_category_distribution.png']
anchors=['B3','V3','B48','V48'];limits=[(1180,570),(1080,570),(1180,600),(1180,600)]
for i,(src,anchor,(max_w,max_h)) in enumerate(zip(chart_sources,anchors,limits),1):
 im=PILImage.open(src);scale=min(max_w/im.width,max_h/im.height);size=(int(im.width*scale),int(im.height*scale));small=OUT/f'chart_{i}_large.png';im.resize(size,PILImage.Resampling.LANCZOS).save(small,optimize=True);xl=XLImage(str(small));xl.width,xl.height=size;charts.add_image(xl,anchor)
charts.freeze_panes='B3'
ov=wb.create_sheet('SAMPLE_OVERVIEW');ov.append(['Case','类别排名','问题类别','类别 Trace 数','占 Agent 编排问题 Trace','具体问题','问题覆盖面','代表 Topic ID','影响状态','责任模块']);header(ov)
for no,x,conv in selected:
 rep=conv['representative'];dev_issue=developer_issue(x.category,rep);main_mid,attribution_basis,candidate_mids=validate_attribution(x.category,rep,dev_issue);dev_issue={**dev_issue,'module_id':main_mid,'module_name':{'L2.2':'GeneralChatAgent','L4.6':'Tools 段引擎','L5.2':'ModelParamsResolver','L5.7':'Parameter Resolver','L6.1':'ToolExecutionService'}.get(main_mid,dev_issue['module_name']),'attribution_basis':attribution_basis,'candidate_modules':candidate_mids};tid=rep['trace_id'];g=R[R.effective_trace_id.astype(str).eq(tid)];eg=E[E.effective_trace_id.astype(str).eq(tid)].sort_values('created_at');topic=next((v(z) for z in g.topic_id.dropna() if v(z).strip()),tid);user=g[g.role.eq('user')];task=compact(user.iloc[0].content,1500) if len(user) else '用户任务待确认';w=conv['winner'];ov.append([no,no,x.category_zh,int(x.trace_count),f"{x.pct:.1f}%",dev_issue['name'],f"影响 {w['n_sessions']} 个去重用户任务",topic,'硬失败（任务最终失败）' if rep['impact_status']=='hard_failed' else '已恢复但存在能力问题',f"{dev_issue['module_id']} {dev_issue['module_name']}"])
 ws=wb.create_sheet(f'CASE_{no:02d}');ws.sheet_view.showGridLines=False
 for c,wid in {'A':18,'B':22,'C':24,'D':27,'E':34,'F':34,'G':38}.items():ws.column_dimensions[c].width=wid
 sections=[('1. Case 标识',[('问题类别',x.category_zh),('类别排名',no),('Topic ID',topic),('影响状态','硬失败（任务最终失败）' if rep['impact_status']=='hard_failed' else '已恢复但存在能力问题')]),('2. 一句话结论',[('结论',f"{dev_issue['name']}。{dev_issue['description']}选择 Topic {tid} 作为典型定位样本。")]),('3. 用户任务',[('任务',task)]),('4. 最终影响',[('影响','任务最终失败。' if rep['impact_status']=='hard_failed' else '任务恢复，但存在真实能力缺陷和额外调用。')]),('5. 根因定位',[('能力层',f"{dev_issue['module_id'].split('.')[0]} Agent 编排/能力链路"),('具体模块',f"{dev_issue['module_id']} {dev_issue['module_name']}"),('具体问题',dev_issue['name']),('主归因依据',dev_issue['attribution_basis']),('候选模块','、'.join(dev_issue['candidate_modules']) if dev_issue['candidate_modules'] else '无'),('问题覆盖面',f"影响 {w['n_sessions']} 个去重用户任务"),('为什么选这条 Trace','该 Trace 能完整展示问题输入、异常输出、恢复或失败结果，适合开发直接定位'),('归因置信度',rep['confidence'])]),('6. 错误/问题证据',[('证据摘要',dev_issue['description']),('归因判断',dev_issue['attribution_basis'])]),('7. 精简调用链',[('调用链','用户请求 → 编排能力节点异常 → 错误暴露 → 恢复路径/最终失败')]),('8. 修复建议',[('立即修复',dev_issue['fix']),('防御性处理','增加机械可验证的前置校验、明确失败状态和安全恢复路径。'),('监控与测试补充','按具体问题监控受影响用户任务数、恢复情况和回归结果。')]),('9. 状态观察项',[('观察项','该 Trace 用于展示当前类别最典型的问题形态；完整选择审计另存于技术文件。')])]
 row=1
 for title,items in sections:
  ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,title);header(ws,row);row+=1
  for k,z in items:ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=2);ws.cell(row,1,k).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,1).font=Font(bold=True);ws.merge_cells(start_row=row,start_column=3,end_row=row,end_column=7);ws.cell(row,3,z);row+=1
  row+=1
 evidence(ws,row,g,eg,{**rep,'module_id':dev_issue['module_id'],'module_name':dev_issue['module_name'],'reason':dev_issue['description'],'failed_tool':rep.get('failed_tool',''),'failure_output':rep.get('failure_output','')},task);den=denoise_trace_nodes(g.to_dict('records'),max_nodes=40);add_rules(wb,no,den,conv,dev_issue);add_audit(wb,no,den)
for ws in wb.worksheets:
 for row in ws.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
out=OUT/'agent_orchestration_top5_single_trace_report.xlsx';wb.save(out);audit=[]
for no,x,conv in selected:
 audit.append({'category':x.category,'category_zh':x.category_zh,'winner':conv['winner'],'representative_trace_id':conv['representative']['trace_id'],'high_risk':conv['high_risk'],'needs_review':conv['needs_review'],'config':conv['config']})
(OUT/'convergence_audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'output':str(out),'sheet_count':len(wb.sheetnames),'case_count':len(selected),'selected':[{'category':x.category_zh,'trace_id':c['representative']['trace_id'],'cause':c['winner']['cause_id'],'severity':c['winner']['severity_level'],'n_sessions':c['winner']['n_sessions'],'score':c['winner']['score']} for _,x,c in selected]},ensure_ascii=False,indent=2))