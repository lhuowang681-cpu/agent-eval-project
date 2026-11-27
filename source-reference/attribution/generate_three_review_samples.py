from pathlib import Path
import json,re
import pandas as pd
from openpyxl import Workbook,load_workbook
from openpyxl.styles import Font,PatternFill,Alignment,Border,Side
from openpyxl.utils import get_column_letter
P=Path(r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx");OUT=Path('output/review_samples');OUT.mkdir(parents=True,exist_ok=True)
R=pd.read_excel(P,sheet_name='RAW_NODES');E=pd.read_excel(P,sheet_name='ERROR_EVENTS')
CASES=[
 dict(no=1,tid='tpc_A6iVTYMRUrW0',l1='模型运行错误',l2='流式连接中断',layer='L5 Model Runtime 层',module='L5.5 Stream Processors',root='Assistant / Model 流式响应节点',exposure='Assistant / Model 流式响应节点',func='Provider Stream Processor / 流式 fetch（具体函数待确认）',confidence='高（0.95）',conclusion='Stream Processors 在模型流式响应期间发生 network error，导致 ConnectionAborted，用户请求未获得可用结果。',impact='任务中断；模型没有产出可用结果，用户无法获得所需 Excel 预测。',fix1='区分客户端 Abort 与上游 network error；对非用户主动中止增加安全重连或明确失败返回。',fix2='保留最后成功 Chunk；重试前校验幂等；禁止将部分输出标记为成功。',fix3='监控 ConnectionAborted、关闭方、最后 Chunk、持续时间、重试结果；补充断流集成测试。'),
 dict(no=2,tid='tpc_xRRBwNDCOUVp',l1='凭证与权限错误',l2='Provider 凭证绑定缺失',layer='L8 横切关注点',module='L8.6 Credentials 管理',root='Provider 凭证绑定查询节点（未单独埋点，待确认）',exposure='Assistant / Model 调用节点',func='Peta Auth bindKey / petaKeyId 绑定查询接口',confidence='高（0.98）',conclusion='Credentials 管理未找到 appId 与 keyName 的绑定关系，模型调用被 PetaAuthError 拒绝，任务直接失败。',impact='任务中断；连续两次用户请求均未获得模型回答。',fix1='补齐 appId-keyName 绑定；启动时校验 petaKeyId 与授权关系。',fix2='模型调用前执行凭证预检；保留 PetaAuthError，不要只包装成 HTTP 500。',fix3='监控 missing binding；增加凭证初始化、轮换和失效场景测试。'),
 dict(no=3,tid='tpc_2uc7jGBkl5ux',l1='模型请求参数错误',l2='Thinking 参数类型错误',layer='L5 Model Runtime 层',module='L5.7 Parameter Resolver',root='Parameter Resolver / Payload 参数构造节点（未单独埋点，待确认）',exposure='Assistant / Model 请求节点',func='thinking 参数解析与 Provider Payload 序列化；字段 thinking',confidence='高（0.99）',conclusion='Parameter Resolver 将 thinking 传为 map，而目标 Provider 只接受 boolean，导致请求反序列化失败，用户任务未执行。',impact='任务中断；Provider 在生成前拒绝请求，没有可用回答。',fix1='按 Provider/Model 能力表将 thinking 规范化为 boolean，或移除不支持参数。',fix2='发送前执行 JSON Schema 校验；参数异常时返回明确客户端错误。',fix3='增加 DeepSeek/GLM 等 Provider 的 thinking 参数契约测试和字段级告警。')]

def clean(v,n=500):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 s=re.sub(r'\s+',' ',re.sub(r'<[^>]+>',' ',str(v))).strip();return s[:n]+('…' if len(s)>n else '')
def parse_error(raw):
 try:d=json.loads(raw) if isinstance(raw,str) else {}
 except:d={}
 vals=[]
 def walk(x):
  if isinstance(x,dict):
   for k,v in x.items():
    if k.lower() in {'type','name','code','status','message','reason','provider','endpoint'} and not isinstance(v,(dict,list)):vals.append(f'{k}: {v}')
    elif isinstance(v,(dict,list)):walk(v)
 walk(d);return ' | '.join(dict.fromkeys(vals))[:1400]
def role_label(role,has_tools=False):
 if role=='user':return 'User'
 if role=='assistant' and has_tools:return 'Assistant / Model → Tool Call'
 if role=='assistant':return 'Assistant / Model'
 if role=='tool':return 'Tool Output / Observation'
 return str(role or 'System')

BLUE='1F4E78';WHITE='FFFFFF';LIGHT='D9EAF7';RED='FEE4E2';YELLOW='FEF0C7';GRAY='F2F4F7';GREEN='ECFDF3';thin=Side(style='thin',color='D0D5DD')
wb=Workbook();wb.remove(wb.active);summary=wb.create_sheet('SAMPLE_OVERVIEW');summary.append(['Case','错误一级类别','错误二级类别','Topic ID','Trace 时间','能力层','具体模块','置信度'])
for c in summary[1]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
soft=[]
for c in CASES:
 g=R[R.effective_trace_id.eq(c['tid'])].sort_values('created_at').drop_duplicates('id',keep='last');eg=E[E.effective_trace_id.eq(c['tid'])].sort_values('created_at');err=eg.iloc[-1];topic=next((str(x) for x in g.topic_id.dropna() if str(x).strip()),'待确认')
 user=g[g.role.eq('user')].head(1);task=clean(user.iloc[0].content if len(user) else '',800) or '用户任务内容不足，待确认'
 summary.append([c['no'],c['l1'],c['l2'],topic,str(err.created_at),c['layer'],c['module'],c['confidence']])
 sh=wb.create_sheet(f"CASE_{c['no']:02d}");sh.sheet_view.showGridLines=False;sh.sheet_view.zoomScale=85
 for col,w in {'A':18,'B':28,'C':28,'D':28,'E':28,'F':28}.items():sh.column_dimensions[col].width=w
 sections=[
 ('1. Case 标识', [('错误类别',f"{c['l1']} / {c['l2']}"),('Case 序号',c['no']),('Topic ID',topic),('Trace 时间',str(err.created_at))]),
 ('2. 一句话结论',[('结论',c['conclusion'])]),
 ('3. 用户任务',[('任务',task)]),
 ('4. 最终影响',[('影响',c['impact'])]),
 ('5. 根因定位',[('根因节点',c['root']),('报错节点',c['exposure']),('能力层',c['layer']),('具体模块',c['module']),('可能的函数/接口',c['func']),('归因置信度',c['confidence'])]),
 ('6. 错误证据',[('用户输入',task),('错误信息',clean(err.error_message,500) or 'error_message 为空'),('Error Detail',parse_error(err.error_raw)),('最终节点',f"{role_label(g.iloc[-1].role, pd.notna(g.iloc[-1].tools))} / is_error={bool(g.iloc[-1].is_error)}")]),
 ('7. 精简调用链',[('调用链',f"用户请求 → 模型决策 → {c['root']} → {c['exposure']} → 最终失败")]),
 ('8. 修复建议',[('立即修复',c['fix1']),('防御性处理',c['fix2']),('监控与测试补充',c['fix3'])]),
 ('9. 软错误观察项',[('观察项','无与本次硬失败无关且已恢复的软错误' if c['no'] in (2,3) else '该 Trace 未发现需要纳入正式统计的其他软错误')])]
 row=1
 for title,items in sections:
  sh.merge_cells(start_row=row,start_column=1,end_row=row,end_column=6);cell=sh.cell(row,1);cell.value=title;cell.fill=PatternFill('solid',fgColor=BLUE);cell.font=Font(color=WHITE,bold=True,size=13);cell.alignment=Alignment(vertical='center');sh.row_dimensions[row].height=24;row+=1
  for k,v in items:
   sh.merge_cells(start_row=row,start_column=1,end_row=row,end_column=2);sh.cell(row,1,k);sh.cell(row,1).fill=PatternFill('solid',fgColor=LIGHT);sh.cell(row,1).font=Font(bold=True)
   sh.merge_cells(start_row=row,start_column=3,end_row=row,end_column=6);sh.cell(row,3,v);sh.cell(row,3).alignment=Alignment(wrap_text=True,vertical='top');sh.row_dimensions[row].height=max(24,min(90,18+len(str(v))//45*15));row+=1
  row+=1
 # compact retained chain at bottom with visible roles, no node ids
 sh.merge_cells(start_row=row,start_column=1,end_row=row,end_column=6);sh.cell(row,1,'保留节点（技术字段已折叠）');sh.cell(row,1).fill=PatternFill('solid',fgColor=BLUE);sh.cell(row,1).font=Font(color=WHITE,bold=True);row+=1
 sh.append([])
 # Build selected visible path: user, parents/error, final
 useful=pd.concat([user,g[g.id.astype(str).isin(set(eg.id.astype(str))|set(eg.parent_id.dropna().astype(str)))],g.tail(1)]).drop_duplicates('id').sort_values('created_at')
 for _,n in useful.iterrows():
  has_tools=pd.notna(n.tools) and str(n.tools) not in {'','nan'};label=role_label(n.role,has_tools)
  content=clean(n.content,800);error=parse_error(n.error)
  display=content or error or '无正文'
  sh.merge_cells(start_row=row,start_column=1,end_row=row,end_column=2);sh.cell(row,1,label);sh.cell(row,1).fill=PatternFill('solid',fgColor=(RED if bool(n.is_error) else GRAY));sh.cell(row,1).font=Font(bold=True)
  sh.merge_cells(start_row=row,start_column=3,end_row=row,end_column=6);sh.cell(row,3,display);sh.cell(row,3).alignment=Alignment(wrap_text=True,vertical='top');sh.row_dimensions[row].height=max(30,min(105,25+len(display)//55*15));row+=1
# Soft errors sheet: known recovered examples from earlier audit, excluded from hard stats
softws=wb.create_sheet('SOFT_ERROR_OBSERVATIONS');softws.append(['Topic ID','候选异常','恢复证据','正式 Badcase 计数'])
soft_rows=[('tpc_ko3VK8a6JpMj','ConnectionAborted / network error','错误后继续执行并输出最终结果','不计入'),('tpc_F6fWMR6R562H','thinking 参数错误','后续搜索工具成功且生成最终回答','不计入')]
for r in soft_rows:softws.append(r)
for c in softws[1]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
# Format
for ws in wb.worksheets:
 ws.freeze_panes='A2';ws.sheet_view.showVerticalScroll=True;ws.sheet_view.showHorizontalScroll=True
 for row in ws.iter_rows():
  for cell in row:cell.alignment=Alignment(vertical='top',wrap_text=True)
 if ws.title in {'SAMPLE_OVERVIEW','SOFT_ERROR_OBSERVATIONS'}:
  for col in ws.columns:
   vals=list(col);ws.column_dimensions[get_column_letter(vals[0].column)].width=min(42,max(12,max(len(str(x.value or '')) for x in vals)+2))
out=OUT/'three_case_review_samples.xlsx';wb.save(out);print(json.dumps({'excel':str(out),'cases':[{'case':c['no'],'trace_id':c['tid']} for c in CASES],'soft_observations':len(soft_rows)},ensure_ascii=False,indent=2))
