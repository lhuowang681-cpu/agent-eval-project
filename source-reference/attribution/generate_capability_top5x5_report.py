from pathlib import Path
import json,re,math
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.utils import get_column_letter
from openpyxl.drawing.image import Image as XLImage
import matplotlib
import matplotlib.pyplot as plt
from PIL import Image as PILImage
from trace_denoiser import denoise_trace_nodes
from representative_case_selector import select_representative_trace
ROOT=Path(__file__).resolve().parent
SRC=Path(r'D:\Users\martinma\Downloads\TripYoYo_Error_Traces_20260720_20260727.xlsx')
CLASSIFIED=ROOT/'output/real_analysis/classified_badcases.json'
OUTCOME=ROOT/'output/trace_outcome_audit.csv'
SOFT=ROOT/'output/capability_issue_analysis/soft_errors/soft_error_details.csv'
OUT=ROOT/'output/capability_issue_analysis';OUT.mkdir(parents=True,exist_ok=True)
BLUE='1F4E78';WHITE='FFFFFF';LIGHT='D9EAF7';ERROR_FILL='FEE4E2';INFER_FILL='FFF1CC'
IMPACT_ZH={'hard_failed':'硬失败（任务最终失败）','recovered_with_capability_issue':'已恢复但存在能力问题','quality_badcase':'质量问题','performance_badcase':'性能问题','eval_badcase':'评测问题','observability_gap':'观测缺口'}
ACTIONABILITY_ZH={'agent_orchestration_actionable':'Agent 编排内可解决','non_orchestration_dependency':'非 Agent 编排可解决（额度/权限/配置/外部依赖）','external_uncontrollable':'外部不可控（Agent 编排无法解决）','attribution_governance':'归因与可观测性治理'}
def impact_zh(v):return IMPACT_ZH.get(val(v),val(v))
def actionability_zh(v):return ACTIONABILITY_ZH.get(val(v),val(v))
def val(v):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 return str(v)
def compact(v,n=1800):
 s=re.sub(r'\s+',' ',val(v)).strip();return s if len(s)<=n else s[:n]+f'…[TRUNCATED:{len(s)-n}]'
def error_detail(v):
 try:return json.dumps(json.loads(v),ensure_ascii=False)[:2500] if isinstance(v,str) else json.dumps(v,ensure_ascii=False)[:2500]
 except:return compact(v,2500)
def header(ws,row=1):
 for c in ws[row]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
def add_rules(wb,no,den):
 ws=wb.create_sheet(f'CASE_{no:02d}_RULES');ws.append(['去噪统计','数据'])
 for x in [('原始节点数',den['stats']['raw_nodes']),('去重后节点数',den['stats']['deduplicated_nodes']),('保留证据节点数',den['stats']['retained_nodes']),('移除节点数',den['stats']['removed_nodes']),('错误节点数',den['stats']['error_nodes'])]:ws.append(x)
 ws.append(['去噪规则','说明'])
 for x in [('节点去重','相同 node_id 仅保留最后一条记录'),('移除展示噪音','移除系统指令、工具 Manifest、Base64/Data URI；超长内容显式截断'),('保留错误节点','所有 is_error/Error Body 节点保留'),('保留父链','保留错误节点至根节点的 Parent 祖先链'),('保留错误时间窗口','保留错误节点前后相邻节点'),('保留直接子节点','保留错误节点的直接 Child 节点'),('保留关键角色','保留报错前最近的 User、Assistant、Tool、Task'),('审计口径',f'CASE_{no:02d}_TRACE_AUDIT 每行是证据节点，不是一轮对话或模型调用')]:ws.append(x)
 for r in [1,7]:header(ws,r)
 ws.column_dimensions['A'].width=24;ws.column_dimensions['B'].width=100
def add_audit(wb,no,den):
 ws=wb.create_sheet(f'CASE_{no:02d}_TRACE_AUDIT');keys=['created_at','role','is_error','retention_reason','provider','model','error_type','error_message','error_detail','content','reasoning','tool_names','tool_signals'];ws.append(['证据节点序号']+keys)
 for i,n in enumerate(den['nodes'],1):ws.append([i]+[json.dumps(n[k],ensure_ascii=False) if isinstance(n[k],(list,dict)) else n[k] for k in keys])
 header(ws);ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
 for i,w in enumerate([12,21,15,10,28,16,24,22,38,55,55,45,30,55],1):ws.column_dimensions[get_column_letter(i)].width=w
def evidence_chain(ws,row,g,eg,issue,task,impact_status,softrow=None):
 ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,'Trace 证据链');header(ws,row);row+=1
 heads=['顺序','节点性质','角色','谁调用了谁','关键输入','关键输出 / Error Detail','支持的判断']
 for j,h in enumerate(heads,1):ws.cell(row,j,h);ws.cell(row,j).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,j).font=Font(bold=True)
 row+=1;rows=[['上下文','User','User → Assistant / Model',task,'','定义用户任务']]
 if softrow is not None:
  rows.append(['推断根因节点','Agent / Workflow',f"{issue.module_id} {issue.module_name}",val(softrow.tool_input),val(softrow.failure_output),'工具输出明确显示能力节点失败；随后恢复，属于非独立 Span 的能力问题定位'])
  rows.append(['报错节点','Tool Output / Observation','Assistant / Model → Tool',val(softrow.failed_tool),val(softrow.failure_output),'直接暴露能力问题'])
  rows.append(['最终表现','Assistant / Model','替代/重试路径 → 最终输出',val(softrow.replacement_tool),f"恢复方式：{softrow.recovered_by}",f"影响状态：{impact_zh(impact_status)}；未计为硬失败，但产生额外节点 {softrow.extra_nodes_after_failure}"])
 else:
  inferred=['推断根因节点','Agent / Workflow',f"{issue.module_id} {issue.module_name}",'异常输入/状态以 Error Detail 为准',val(issue.reason),'按固定归因树定位最早产生异常数据的能力模块；节点可能为逻辑反推']
  rows.append(inferred)
  if len(eg):
   e=eg.iloc[-1];rows.append(['报错节点','Assistant / Model','User → Assistant / Model','',error_detail(e.error_raw) or val(e.error_message),'直接暴露失败'])
  rows.append(['最终失败','Assistant / Model','上游错误 → 最终节点','',val(issue.reason),f'影响状态：{impact_zh(impact_status)}'])
 for i,x in enumerate(rows,1):
  fill=ERROR_FILL if x[0]=='报错节点' else (INFER_FILL if x[0]=='推断根因节点' else WHITE)
  for j,v in enumerate([i]+x,1):ws.cell(row,j,v);ws.cell(row,j).fill=PatternFill('solid',fgColor=fill)
  ws.row_dimensions[row].height=max(30,min(105,25+max(len(val(v)) for v in x)//70*15));row+=1
 return row
# Load evidence data
R=pd.read_excel(SRC,sheet_name='RAW_NODES').sort_values(['effective_trace_id','created_at']).drop_duplicates('id',keep='last');E=pd.read_excel(SRC,sheet_name='ERROR_EVENTS');C=pd.DataFrame(json.loads(CLASSIFIED.read_text(encoding='utf-8')));O=pd.read_csv(OUTCOME,encoding='utf-8-sig');S=pd.read_csv(SOFT,encoding='utf-8-sig')
outcome=dict(zip(O.trace_id.astype(str),O.outcome));issues=[]
# Runtime/observability issues: one primary issue per trace.
for _,r in C.iterrows():
 status='hard_failed' if outcome.get(str(r.trace_id))=='hard_failed' else ('observability_gap' if r.badcase_kind=='observability_gap' else 'recovered_with_capability_issue')
 issues.append({'trace_id':str(r.trace_id),'issue_category':r.error_category,'issue_category_zh':r.error_category_zh,'layer_id':r.layer_id,'layer_name':r.layer_name,'module_id':r.module_id,'module_name':r.module_name,'impact_status':status,'confidence':r.confidence,'reason':r.reason,'source':'classified_trace','extra_nodes':0})
# Recovered tool capability issues from semantic Tool Result checks.
for _,r in S.iterrows():
 issues.append({'trace_id':str(r.trace_id),'issue_category':r.soft_error_category,'issue_category_zh':r.soft_error_category_zh,'layer_id':r.layer_id,'layer_name':'工具执行层','module_id':r.module_id,'module_name':r.module_name,'impact_status':'recovered_with_capability_issue','confidence':.9,'reason':f"{r.failed_tool} 失败后通过 {r.recovered_by} 恢复",'source':'soft_tool_observation','extra_nodes':r.extra_nodes_after_failure})
I=pd.DataFrame(issues).drop_duplicates(['trace_id','issue_category'])
# Strict Agent-orchestration actionability gate. Top5/Case only contains issues
# fixable by orchestration code/strategy/state/context/parameter transformation/tool routing.
EXTERNAL_CATEGORIES={'stream_connection_aborted','provider_gateway_timeout','provider_rate_limited','mcp_oauth_token_expired','provider_content_safety_rejected'}
DEPENDENCY_CATEGORIES={'subscription_budget_limit_reached','provider_credential_binding_missing','provider_model_permission_denied','coding_plan_unavailable','model_not_found','insufficient_quota'}
EXTERNAL_PATTERNS=re.compile(r'network error|econnreset|premature close|gateway|upstream timeout|rate.?limit|engine overloaded|external provider|grant token has expired',re.I)
DEPENDENCY_PATTERNS=re.compile(r'预算|费用上限|quota|insufficient budget|credential|凭证|no binding|permission|权限|coding plan|api key|token expired',re.I)
def actionability(r):
 cat=val(r.issue_category);reason=val(r.reason);mid=val(r.module_id)
 if mid=='L8.3' or cat=='unclassified_runtime_error':return ('attribution_governance','归因/可观测性内部治理，不属于 Agent 编排能力修复范围')
 if cat in EXTERNAL_CATEGORIES or EXTERNAL_PATTERNS.search(reason):return ('external_uncontrollable','直接根因为外部网络、网关、Provider 或授权上游，Agent 编排无法解决')
 if cat in DEPENDENCY_CATEGORIES or mid in {'L2.4','L8.2','L8.6'} or DEPENDENCY_PATTERNS.search(reason):return ('non_orchestration_dependency','直接根因为额度、套餐、账号权限、凭证绑定或环境配置，需充值/授权/配置处理，不能依靠 Agent 编排修复')
 return ('agent_orchestration_actionable','可通过 Agent 编排代码或策略处理：状态机、上下文工程、参数转换、工具选择/调用、Skill 调度、结果回填、重试与恢复机制')
I[['actionability','actionability_reason']]=I.apply(lambda r:pd.Series(actionability(r)),axis=1)
dev=I[I.actionability.eq('agent_orchestration_actionable')].copy();quality=I[I.actionability.eq('attribution_governance')].copy();external=I[I.actionability.eq('external_uncontrollable')].copy();dependency=I[I.actionability.eq('non_orchestration_dependency')].copy();total=dev.trace_id.nunique()
rank=dev.groupby(['issue_category','issue_category_zh'],dropna=False).trace_id.nunique().reset_index(name='trace_count').sort_values(['trace_count','issue_category'],ascending=[False,True]).head(5).reset_index(drop=True);rank['pct_problem_traces']=(rank.trace_count/total*100).round(1)
# Select 5 representative traces/category: evidence/status first, then repeatability/debuggability.
selections=[]
for catno,x in rank.iterrows():
 cand=dev[dev.issue_category.eq(x.issue_category)].copy();cand['impact_priority']=cand.impact_status.map({'hard_failed':5,'quality_badcase':4,'performance_badcase':3,'eval_badcase':3,'recovered_with_capability_issue':2,'observability_gap':1}).fillna(1);cand=cand.sort_values(['impact_priority','extra_nodes','confidence','trace_id'],ascending=[False,False,False,True]).drop_duplicates('trace_id').head(5)
 for within,(_,r) in enumerate(cand.iterrows(),1):selections.append((catno+1,within,x,r))
# charts
for f in ['Microsoft YaHei','SimHei','Arial Unicode MS']:matplotlib.rcParams['font.family']=f;break
colors=['#D92D20','#F79009','#1570EF','#12B76A','#7A5AF8','#06AED4','#EE46BC','#6172F3','#F63D68','#2E90FA']
bar=rank.iloc[::-1];fig,ax=plt.subplots(figsize=(12,5.8));bs=ax.barh(range(len(bar)),bar.trace_count,color=colors[:len(bar)][::-1]);ax.set_yticks(range(len(bar)));ax.set_yticklabels(bar.issue_category_zh)
for b,(_,r) in zip(bs,bar.iterrows()):ax.text(b.get_width()+.15,b.get_y()+b.get_height()/2,f"{int(r.trace_count)} ({r.pct_problem_traces:.1f}%)",va='center',fontweight='bold')
ax.set_xlim(0,max(bar.trace_count)*1.32);ax.spines[['top','right','left']].set_visible(False);ax.grid(axis='x',alpha=.15);plt.tight_layout();ch1=OUT/'01_attribution_issue_top5.png';fig.savefig(ch1,dpi=180,bbox_inches='tight');plt.close(fig)
mod=dev.groupby(['module_id','module_name']).trace_id.nunique().reset_index(name='trace_count').sort_values('trace_count',ascending=False);mod['pct']=(mod.trace_count/total*100).round(1);fig,ax=plt.subplots(figsize=(16,9));wedges,_=ax.pie(mod.trace_count,startangle=90,colors=(colors*10)[:len(mod)]);ax.legend(wedges,[f"{r.module_id} {r.module_name}  {int(r.trace_count)} ({r.pct:.1f}%)" for _,r in mod.iterrows()],loc='center left',bbox_to_anchor=(1,.5),frameon=False);ax.axis('equal');ch2=OUT/'02_attribution_module_distribution.png';fig.savefig(ch2,dpi=180,bbox_inches='tight');plt.close(fig)
# Physically downscale PNGs before embedding. Some Excel/WPS versions ignore DrawingML
# display extents and render the source pixel dimensions, causing overlap.
def resize_png(path,max_width,max_height):
 im=PILImage.open(path);scale=min(max_width/im.width,max_height/im.height,1);size=(max(1,int(im.width*scale)),max(1,int(im.height*scale)));im.resize(size,PILImage.Resampling.LANCZOS).save(path,optimize=True);return size
chart1_size=resize_png(ch1,900,420);chart2_size=resize_png(ch2,1000,540)
# workbook
wb=Workbook();wb.remove(wb.active);charts=wb.create_sheet('00_CHARTS');charts.sheet_view.showGridLines=False;charts.sheet_view.zoomScale=70
# Explicitly resize and separate both images to avoid overlap in Excel/WPS.
for col in range(1,15):charts.column_dimensions[get_column_letter(col)].width=12
for rowno in range(1,96):charts.row_dimensions[rowno].height=18
charts.merge_cells('B1:M1');charts['B1']='Agent 编排内可解决问题 Top 5';charts['B1'].font=Font(size=15,bold=True,color=BLUE);charts['B1'].alignment=Alignment(horizontal='center')
img1=XLImage(str(ch1));img1.width,img1.height=chart1_size;charts.add_image(img1,'B3')
charts.merge_cells('B30:M30');charts['B30']='Agent 编排内可解决责任模块分布';charts['B30'].font=Font(size=15,bold=True,color=BLUE);charts['B30'].alignment=Alignment(horizontal='center')
img2=XLImage(str(ch2));img2.width,img2.height=chart2_size;charts.add_image(img2,'B32')
charts.freeze_panes='B3'
ov=wb.create_sheet('SAMPLE_OVERVIEW');ov.append(['Case','类别排名','类别内排名','问题类别','类别 Trace 数','占 Agent 编排内可解决问题 Trace','Topic ID','影响状态','可解决性','能力层','责任模块','置信度']);header(ov)
for no,(catno,within,x,issue) in enumerate(selections,1):
 tid=issue.trace_id;g=R[R.effective_trace_id.astype(str).eq(tid)];eg=E[E.effective_trace_id.astype(str).eq(tid)].sort_values('created_at');user=g[g.role.eq('user')];task=compact(user.iloc[0].content,1500) if len(user) else '用户任务待确认';topic=next((val(v) for v in g.topic_id.dropna() if val(v).strip()),tid);ov.append([no,catno,within,x.issue_category_zh,int(x.trace_count),f"{x.pct_problem_traces:.1f}%",topic,impact_zh(issue.impact_status),actionability_zh(issue.actionability),f"{issue.layer_id} {issue.layer_name}",f"{issue.module_id} {issue.module_name}",issue.confidence])
 ws=wb.create_sheet(f'CASE_{no:02d}');ws.sheet_view.showGridLines=False
 for c,w in {'A':18,'B':22,'C':24,'D':27,'E':34,'F':34,'G':38}.items():ws.column_dimensions[c].width=w
 sections=[('1. Case 标识',[('问题类别',x.issue_category_zh),('Case 序号',no),('类别排名',catno),('类别内排名',within),('Topic ID',topic),('影响状态',impact_zh(issue.impact_status)),('可解决性',actionability_zh(issue.actionability)),('纳入依据',issue.actionability_reason)]),('2. 一句话结论',[('结论',f"{issue.module_id} {issue.module_name} 出现“{x.issue_category_zh}”。{issue.reason}")]),('3. 用户任务',[('任务',task)]),('4. 最终影响',[('影响','任务最终失败。' if issue.impact_status=='hard_failed' else '任务已恢复或继续执行，但暴露真实能力缺陷和额外开销。')]),('5. 根因定位',[('能力层',f"{issue.layer_id} {issue.layer_name}"),('具体模块',f"{issue.module_id} {issue.module_name}"),('归因置信度',issue.confidence)]),('6. 错误/问题证据',[('证据摘要',issue.reason)]),('7. 精简调用链',[('调用链','用户请求 → 能力节点异常 → 错误暴露 → 恢复路径/最终失败')]),('8. 修复建议',[('立即修复',f"优先修复 {issue.module_id} {issue.module_name} 中的直接能力缺陷。"),('防御性处理','增加前置校验、明确失败状态和安全替代路径。'),('监控与测试补充','补充模块级成功率、恢复率、额外调用和回归测试。')]),('9. 状态观察项',[('观察项',f"影响状态：{impact_zh(issue.impact_status)}")])]
 row=1
 for title,items in sections:
  ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,title);header(ws,row);row+=1
  for k,v in items:
   ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=2);ws.cell(row,1,k).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,1).font=Font(bold=True);ws.merge_cells(start_row=row,start_column=3,end_row=row,end_column=7);ws.cell(row,3,v);row+=1
  row+=1
 softrow=None
 if issue.source=='soft_tool_observation':
  ss=S[(S.trace_id.astype(str)==tid)&(S.soft_error_category==issue.issue_category)];softrow=ss.sort_values('extra_nodes_after_failure',ascending=False).iloc[0] if len(ss) else None
 row=evidence_chain(ws,row,g,eg,issue,task,issue.impact_status,softrow);den=denoise_trace_nodes(g.to_dict('records'),max_nodes=40);add_rules(wb,no,den);add_audit(wb,no,den)
# governance and impact summaries
imp=wb.create_sheet('IMPACT_SUMMARY');impdf=dev.groupby('impact_status').trace_id.nunique().reset_index(name='trace_count').sort_values('trace_count',ascending=False);impdf['影响状态']=impdf.impact_status.map(impact_zh);imp.append(['影响状态','Trace 数']);[imp.append([r['影响状态'],r.trace_count]) for _,r in impdf.iterrows()];header(imp)
cols=['Trace ID','问题类别代码','问题类别','模块 ID','模块名称','影响状态','可解决性','可解决性依据','归因原因']
ext=wb.create_sheet('EXTERNAL_UNCONTROLLABLE');ext.append(cols);[ext.append([r.trace_id,r.issue_category,r.issue_category_zh,r.module_id,r.module_name,impact_zh(r.impact_status),actionability_zh(r.actionability),r.actionability_reason,r.reason]) for _,r in external.iterrows()];header(ext)
dep=wb.create_sheet('NON_ORCHESTRATION_DEPENDENCY');dep.append(cols);[dep.append([r.trace_id,r.issue_category,r.issue_category_zh,r.module_id,r.module_name,impact_zh(r.impact_status),actionability_zh(r.actionability),r.actionability_reason,r.reason]) for _,r in dependency.iterrows()];header(dep)
policy=wb.create_sheet('ACTIONABILITY_RULES');policy.append(['可解决性','是否进入Top5/Case','判定说明']);policy.append(['Agent 编排内可解决','是','可通过 Agent 状态机、上下文工程、参数转换、工具选择/调用、Skill调度、结果回填、重试与恢复机制解决']);policy.append(['非 Agent 编排可解决（额度/权限/配置/外部依赖）','否','套餐、Token/Quota额度、充值、账号权限、凭证绑定和环境开通等需配置或运营处理，不能依靠 Agent 编排解决']);policy.append(['外部不可控（Agent 编排无法解决）','否','外部网络、上游网关、Provider过载/限流、第三方授权系统等，Agent 编排无法修复直接根因']);policy.append(['归因与可观测性治理','否','Trace、Span、Error Body或证据链缺失，由归因与可观测性建设方治理']);header(policy)
for ws in wb.worksheets:
 ws.sheet_view.showVerticalScroll=True;ws.sheet_view.showHorizontalScroll=True
 for row in ws.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
out=OUT/'agent_orchestration_actionable_top5x5_report.xlsx';wb.save(out);print(json.dumps({'output':str(out),'agent_orchestration_actionable_records':len(dev),'agent_orchestration_actionable_traces':total,'top5':rank.to_dict('records'),'case_count':len(selections),'impact':impdf.to_dict('records'),'non_orchestration_dependency_records':len(dependency),'non_orchestration_dependency_traces':dependency.trace_id.nunique(),'external_records':len(external),'external_traces':external.trace_id.nunique(),'quality_records':len(quality),'chart1':str(ch1),'chart2':str(ch2)},ensure_ascii=False,indent=2))
