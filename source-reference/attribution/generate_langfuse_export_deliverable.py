from pathlib import Path
import json,re,math
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.utils import get_column_letter
from openpyxl.drawing.image import Image as XLImage
from PIL import Image as PILImage
import matplotlib;import matplotlib.pyplot as plt
import sys
SKILL=Path(r'D:\Users\martinma\tripyoyo源码\skills\langfuse-agent-badcase-attribution');sys.path.insert(0,str(SKILL))
from cause_convergence import medoid
from langfuse_trace_recoverer import load_reconstructed,recover_events,denoise_for_signal
ROOT=Path(r'D:\Users\martinma\tripyoyo源码');OUT=ROOT/'new_export_output';OUT.mkdir(exist_ok=True)
D=pd.DataFrame(json.loads((ROOT/'new_export_refined.json').read_text(encoding='utf-8')))
MAP={
'sql_unreplaced_variable':('SQL模板变量未替换','L2.2','GeneralChatAgent','Agent 生成并执行了仍含 ${...} 占位符的 SQL，异常数据在工具调用前已形成。','执行前检查并拒绝包含未解析模板变量的 SQL。'),
'sql_table_not_found':('SQL引用不存在的表','L2.2','GeneralChatAgent','执行引擎明确返回 table not found / NoSuchObjectException，Agent 未在执行前完成表存在性校验。','生成 SQL 前通过元数据工具确认表存在及库名，并禁止未经核验的表进入执行。'),
'sql_syntax_error':('SQL语法错误','L2.2','GeneralChatAgent','执行引擎明确返回 SQLSyntaxError/ParseException，错误 SQL 在调用前由 Agent 生成。','工具调用前执行 SQL 语法和方言校验。'),
'sql_execution_generic':('SQL执行失败但错误详情不足','L6.1','ToolExecutionService','工具结果只返回 execution exit code 或笼统失败，缺少更具体的可定位错误体。','工具执行层保留完整引擎错误、失败阶段和原始日志。'),
'tool_validation_error':('Agent 生成的工具命令或参数不符合契约','L2.2','GeneralChatAgent','工具执行前按契约拒绝了错误命令或参数，异常数据最早由 Agent 决策生成。','调用前按照工具 Schema 校验命令名、必填字段和字段类型。'),
'tool_endpoint_returned_html':('工具端点返回 HTML 导致 JSON 解析失败','L6.1','ToolExecutionService','Tool Result 返回 HTML/非 JSON，失败在工具结果解析节点直接暴露。','校验 Content-Type 与结果结构，保留原始响应并触发可控降级。'),
'sql_timeout':('SQL执行超时','L2.2','GeneralChatAgent','SQL执行超时，需结合查询复杂度判断 Agent 是否生成了低效查询。','执行前进行查询复杂度校验并拆分大查询。')}
D[['specific_issue','module_id','module_name','basis','fix']]=D.category.apply(lambda x:pd.Series(MAP[x]))
TRACE_STORE=load_reconstructed(ROOT/'langfuse_reconstructed_traces.jsonl')
RECOVERED={}
def recovered_nodes(rep):
 tid=rep['trace_id'] if isinstance(rep,dict) else rep.trace_id;signal=rep['signal'] if isinstance(rep,dict) else rep.signal
 key=(tid,signal)
 if key not in RECOVERED:
  tr=TRACE_STORE.get(tid,{});events=recover_events(tr) if tr else [];sel,focus,score=denoise_for_signal(events,signal);RECOVERED[key]=(sel,focus,score)
 return RECOVERED[key]
def clean(s,n=2600):
 s=str(s or '');s=s.replace('\\n',' ').replace('\\r',' ');s=re.sub(r'\\+"','"',s);s=re.sub(r'\s+',' ',s).strip();return s[:n]+('…' if len(s)>n else '')
def scene(s):
 s=s.lower();rules=[('任务与子Agent',r'exectask|callsubagent|sub.?agent'),('用户记忆',r'searchusermemory|addpreferencememory|memory'),('知识库RAG',r'knowledge.?base|知识库|\brag\b|embedding'),('联网研究',r'web-browsing|crawl|firecrawl|google|baidu|bing'),('Skill工作流',r'lobe-skills|activateskill|selected_skill'),('文档报告',r'\.docx|\.pptx|\.pdf|报告|飞书文档'),('文件与代码',r'runcommand|executecode|\.py\b|代码|文件|excel|xlsx|csv'),('其他原生工具',r'____.*____|mcp|tool')]
 for n,p in rules:
  if re.search(p,s,re.I):return n
 return '纯问答与多轮文本'
D['scene']=D.context.map(scene);D['context_clean']=D.context.map(clean)
def user_task(s):
 # best-effort user content near direct error; do not expose system prompt
 pats=[r'"role"\s*:\s*"user"[^}]{0,2000}"content"\s*:\s*"([^"]{1,1200})"',r'"content"\s*:\s*"([^"]{1,1200})"[^}]{0,300}"role"\s*:\s*"user"']
 hits=[]
 for p in pats:hits+=re.findall(p,s,re.I|re.S)
 return clean(hits[-1],900) if hits else '原始导出片段未保留可稳定提取的用户任务文本'
D['task']=D.context.map(user_task)
def location(r):
 if r.category=='sql_execution_failed':return 'Tool Result / SQL execution failed'
 if r.category=='context_window_exceeded':return 'Assistant / Model 请求前上下文构造'
 if r.category=='tool_execution_error':return 'Tool Result / ToolExecutionError'
 if r.category=='tool_validation_error':return 'Tool Result / 参数契约校验'
 return 'Tool Result / 非 JSON 响应解析'
D['error_location']=D.apply(location,axis=1)
# Top5 by unique user task (topic)
rank=D.groupby(['category','category_zh']).topic_id.nunique().reset_index(name='trace_count').sort_values(['trace_count','category'],ascending=[False,True]).head(5).reset_index(drop=True);rank['pct']=(rank.trace_count/D.topic_id.nunique()*100).round(1)
selected=[]
for i,r in rank.iterrows():
 cluster=D[D.category==r.category].to_dict('records');rep,_=medoid(cluster,'context_clean');selected.append((i+1,r,rep))
# charts
for f in ['Microsoft YaHei','SimHei','Arial Unicode MS']:matplotlib.rcParams['font.family']=f;break
colors=['#1570EF','#7A5AF8','#12B76A','#F79009','#D92D20','#06AED4','#EE46BC','#6172F3','#039855']
def save_bar(data,label_col,value_col,path,xlabel):
 p=data.iloc[::-1];fig,ax=plt.subplots(figsize=(12,6));bars=ax.barh(p[label_col],p[value_col],color=colors[:len(p)][::-1]);
 for b,v in zip(bars,p[value_col]):ax.text(b.get_width()+.2,b.get_y()+b.get_height()/2,str(int(v)),va='center',fontweight='bold')
 ax.set_xlabel(xlabel);ax.spines[['top','right','left']].set_visible(False);ax.grid(axis='x',alpha=.15);plt.tight_layout();fig.savefig(path,dpi=180,bbox_inches='tight');plt.close(fig)
ch1=OUT/'01_top5_category.png';save_bar(rank,'category_zh','trace_count',ch1,'去重用户任务数')
mod=D.groupby(['module_id','module_name']).topic_id.nunique().reset_index(name='trace_count').sort_values('trace_count',ascending=False);ch2=OUT/'02_module_distribution.png';save_bar(mod.assign(label=mod.module_id+' '+mod.module_name),'label','trace_count',ch2,'去重用户任务数')
sc=D.groupby('scene').topic_id.nunique().reset_index(name='trace_count').sort_values('trace_count',ascending=False);ch3=OUT/'03_scene_distribution.png';save_bar(sc,'scene','trace_count',ch3,'去重用户任务数')
cross=D.groupby(['scene','category_zh']).topic_id.nunique().reset_index(name='trace_count');pv=cross.pivot(index='scene',columns='category_zh',values='trace_count').fillna(0);fig,ax=plt.subplots(figsize=(14,7));left=pd.Series(0,index=pv.index,dtype=float)
for i,c in enumerate(pv.columns):ax.barh(pv.index,pv[c],left=left,label=c,color=colors[i]);left+=pv[c]
ax.legend(loc='upper center',bbox_to_anchor=(.5,-.09),ncol=3,frameon=False);ax.set_xlabel('去重用户任务数');plt.tight_layout();ch4=OUT/'04_scene_category.png';fig.savefig(ch4,dpi=180,bbox_inches='tight');plt.close(fig)
# workbook
BLUE='1F4E78';WHITE='FFFFFF';LIGHT='D9EAF7';RED='FEE4E2';YELLOW='FFF1CC'
def header(ws,row=1):
 for c in ws[row]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True);c.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
wb=Workbook();wb.remove(wb.active);charts=wb.create_sheet('00_CHARTS');charts.sheet_view.showGridLines=False;charts.sheet_view.zoomScale=50
for col in range(1,45):charts.column_dimensions[get_column_letter(col)].width=12
for rn in range(1,120):charts.row_dimensions[rn].height=18
for i,(src,anchor,lim) in enumerate(zip([ch1,ch3,ch2,ch4],['B3','V3','B48','V48'],[(1180,570),(1080,570),(1180,600),(1180,600)]),1):
 im=PILImage.open(src);scale=min(lim[0]/im.width,lim[1]/im.height);sz=(int(im.width*scale),int(im.height*scale));small=OUT/f'chart_{i}.png';im.resize(sz,PILImage.Resampling.LANCZOS).save(small);xl=XLImage(str(small));xl.width,xl.height=sz;charts.add_image(xl,anchor)
ov=wb.create_sheet('SAMPLE_OVERVIEW');ov.append(['Case','类别排名','问题类别','类别 Trace 数','占 Agent 编排问题 Trace','具体问题','问题覆盖面','代表 Topic ID','影响状态','责任模块']);header(ov)
for no,r,rep in selected:ov.append([no,no,r.category_zh,int(r.trace_count),f'{r.pct:.1f}%',rep['specific_issue'],f"影响 {r.trace_count} 个去重用户任务",rep['topic_id'],'已恢复或失败（以原始 Trace 为准）',f"{rep['module_id']} {rep['module_name']}"])
def add_case(no,r,rep):
 ws=wb.create_sheet(f'CASE_{no:02d}');ws.sheet_view.showGridLines=False
 for c,w in {'A':18,'B':22,'C':24,'D':27,'E':34,'F':34,'G':38}.items():ws.column_dimensions[c].width=w
 sections=[('1. Case 标识',[('问题类别',r.category_zh),('类别排名',no),('Topic ID',rep['topic_id']),('Trace ID',rep['trace_id'])]),('2. 一句话结论',[('结论',f"{rep['specific_issue']}。{rep['basis']}")]),('3. 用户任务',[('任务',rep['task'])]),('4. 最终影响',[('影响','该问题导致任务失败或触发额外重试/绕行，具体以原始 Trace 为准。')]),('5. 根因定位',[('能力层',rep['module_id'].split('.')[0]+' Agent 编排/能力链路'),('具体模块',rep['module_id']+' '+rep['module_name']),('具体问题',rep['specific_issue']),('主归因依据',rep['basis']),('问题覆盖面',f"影响 {int(r.trace_count)} 个去重用户任务"),('归因置信度','中高（基于明确错误信号）')]),('6. 错误/问题证据',[('错误信号',rep['signal']),('Error Detail / 上下文',rep['context_clean'])]),('7. 精简调用链',[('调用链','用户请求 → 关键调用 → 首次异常 → 错误暴露 → 最终表现')]),('8. 修复建议',[('立即修复',rep['fix']),('防御性处理','增加前置契约校验、明确失败状态和安全恢复路径。'),('监控与测试补充','按具体问题监控影响任务数、失败率和修复回归结果。')]),('9. 状态观察项',[('观察项','本 Case 来自本次 Langfuse 导出中的真实 Trace。')])]
 row=1
 for title,items in sections:
  ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,title);header(ws,row);row+=1
  for k,z in items:ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=2);ws.cell(row,1,k).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,1).font=Font(bold=True);ws.merge_cells(start_row=row,start_column=3,end_row=row,end_column=7);ws.cell(row,3,z);ws.row_dimensions[row].height=max(24,min(105,18+len(str(z))//55*15));row+=1
  row+=1
 ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,'Trace 证据链');header(ws,row);row+=1
 hh=['顺序','节点性质','角色','谁调用了谁','关键输入','关键输出 / Error Detail','支持的判断']
 for j,h in enumerate(hh,1):ws.cell(row,j,h);ws.cell(row,j).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,j).font=Font(bold=True)
 row+=1;chain=[['上下文','User','User → Assistant / Model',rep['task'],'','定义用户任务'],['推断根因节点','Agent / Workflow',rep['module_id']+' '+rep['module_name'],'异常输入/状态见原始 Trace',rep['basis'],'根据错误字段与失败结果定位'],['报错节点','Tool/Model Output','上游 → 报错节点','',rep['context_clean'],'直接暴露问题'],['最终表现','Assistant / Model','上游错误 → 最终节点','','见原始 Trace','任务失败或恢复']]
 for i,x in enumerate(chain,1):
  fill=RED if x[0]=='报错节点' else (YELLOW if '推断' in x[0] else WHITE)
  for j,z in enumerate([i]+x,1):ws.cell(row,j,z);ws.cell(row,j).fill=PatternFill('solid',fgColor=fill);ws.cell(row,j).alignment=Alignment(vertical='top',wrap_text=True)
  row+=1
 return ws
for no,r,rep in selected:
 ws=add_case(no,r,rep)
 # RULES
 ru=wb.create_sheet(f'CASE_{no:02d}_RULES');ru.append(['证据与选样说明','说明']);header(ru);items=[('具体问题',rep['specific_issue']),('代表 Topic ID',rep['topic_id']),('问题覆盖面',f"影响 {int(r.trace_count)} 个去重用户任务"),('选择理由','该 Trace 最接近同类错误文本主体且保留明确错误信号'),('数据来源','本次 Langfuse Trace 导出')]
 for x in items:ru.append(x)
 ru.column_dimensions['A'].width=28;ru.column_dimensions['B'].width=100
 # Recovered message-level causal trace, then denoised around the direct failure signal.
 au=wb.create_sheet(f'CASE_{no:02d}_TRACE_AUDIT');au.append(['证据节点序号','节点性质','角色','工具名称','关键输入','关键输出 / Error Detail','支持的判断','Trace ID','Topic ID']);header(au)
 nodes,focus,match_score=recovered_nodes(rep)
 for seq,e in enumerate(nodes,1):
  text=clean(e.get('content',''),2200);args=clean(e.get('arguments',''),1800);name=e.get('name','')
  low=(text+' '+name+' '+args).lower();isfail=(rep['signal'].lower() in low) or bool(re.search(r'failed|error|invalid|timeout|not found|disabled|unavailable|exception',low,re.I))
  if e['role']=='user':kind='上下文';caller='定义用户任务'
  elif e['role']=='assistant' and name:kind='工具调用';caller='向工具发起调用'
  elif e['role']=='tool' and isfail:kind='报错节点';caller='直接暴露失败'
  elif e['role']=='tool':kind='工具结果';caller='返回工具执行结果'
  else:kind='模型输出';caller='异常前后模型行为'
  au.append([seq,kind,e['role'],name,args,text,caller,rep['trace_id'],rep['topic_id']]);au.row_dimensions[au.max_row].height=max(28,min(100,25+max(len(args),len(text))//90*15))
 for i,w in enumerate([12,18,14,38,62,75,28,38,24],1):au.column_dimensions[get_column_letter(i)].width=w
 au.freeze_panes='A2';au.auto_filter.ref=au.dimensions
 for row in au.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
out=OUT/'agent_orchestration_top5_single_trace_new_export.xlsx';wb.save(out);D.to_csv(OUT/'classified_records.csv',index=False,encoding='utf-8-sig');print(json.dumps({'output':str(out),'records':len(D),'topics':D.topic_id.nunique(),'top5':rank.to_dict('records'),'representatives':[{'category':r.category_zh,'trace_id':rep['trace_id'],'topic_id':rep['topic_id']} for _,r,rep in selected],'sheet_count':len(wb.sheetnames)},ensure_ascii=False,indent=2))
