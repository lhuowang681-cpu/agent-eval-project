from pathlib import Path
import json,re
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Font,PatternFill,Alignment
from openpyxl.utils import get_column_letter
from trace_denoiser import denoise_trace_nodes
from representative_case_selector import select_representative_trace
ROOT=Path(__file__).resolve().parent
SRC=Path(r'D:\Users\martinma\Downloads\TripYoYo_Error_Traces_20260720_20260727.xlsx')
CLASSIFIED=ROOT/'output/real_analysis/classified_badcases.json'
OUT=ROOT/'output/top5_case_review';OUT.mkdir(parents=True,exist_ok=True)
BLUE='1F4E78';WHITE='FFFFFF';LIGHT='D9EAF7';ERROR_FILL='FEE4E2';CONTEXT_FILL='FFFFFF'

def val(v):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 return str(v)
def compact(v,n=1800):
 s=re.sub(r'\s+',' ',val(v)).strip()
 return s if len(s)<=n else s[:n]+f'…[TRUNCATED:{len(s)-n}]'
def err_detail(v):
 try:
  d=json.loads(v) if isinstance(v,str) else v
  return json.dumps(d,ensure_ascii=False)[:2500]
 except:return compact(v,2500)
def header(ws,row=1):
 for c in ws[row]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True)
def add_rules(wb,no,den):
 ws=wb.create_sheet(f'CASE_{no:02d}_RULES');ws.append(['去噪统计','数据'])
 for x in [('原始节点数',den['stats']['raw_nodes']),('去重后节点数',den['stats']['deduplicated_nodes']),('保留证据节点数',den['stats']['retained_nodes']),('移除节点数',den['stats']['removed_nodes']),('错误节点数',den['stats']['error_nodes'])]:ws.append(x)
 ws.append(['去噪规则','说明'])
 for x in [('节点去重','相同 node_id 仅保留最后一条记录'),('移除展示噪音','移除系统指令、工具 Manifest、Base64/Data URI；超长内容显式截断'),('保留错误节点','所有 is_error/Error Body 节点保留'),('保留父链','保留错误节点至根节点的 Parent 祖先链'),('保留错误时间窗口','保留错误节点前后相邻节点'),('保留直接子节点','保留错误节点的直接 Child 节点'),('保留关键角色','保留报错前最近的 User、Assistant、Tool、Task'),('审计口径',f'CASE_{no:02d}_TRACE_AUDIT 每行是证据节点，不是一轮对话或模型调用')]:ws.append(x)
 for rr in [1,7]:header(ws,rr)
 ws.column_dimensions['A'].width=24;ws.column_dimensions['B'].width=100;ws.freeze_panes='A2'
def add_evidence_chain(ws,row,g,eg,rec,task,impact):
 # Exact accepted CASE Trace evidence-chain semantics: concise causal locator,
 # not the full denoised audit/ancestor list.
 ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,'Trace 证据链');header(ws,row);row+=1
 heads=['顺序','节点性质','角色','谁调用了谁','关键输入','关键输出 / Error Detail','支持的判断']
 for j,h in enumerate(heads,1):ws.cell(row,j,h);ws.cell(row,j).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,j).font=Font(bold=True)
 row+=1
 rows=[['上下文','User','User → Assistant / Model',task,'','定义用户任务']]
 cat=val(rec.error_category)
 inferred={
  'subscription_budget_limit_reached':['推断根因节点','Agent / Workflow','L2.4 UsageCounter','当前套餐/周期用量与预算状态','套餐预算达到上限，模型请求被拒绝','Error Detail 明确给出预算或套餐上限状态；节点为逻辑反推，非独立 Span'],
  'provider_credential_binding_missing':['推断根因节点','Agent / Workflow','L8.6 Credentials 管理','appId + keyName / petaKeyId（具体原值未记录）','凭证绑定不存在；Provider 要求先完成绑定','下游鉴权错误明确给出绑定缺失和修复动作；节点为逻辑反推，非独立 Span'],
  'model_parameter_missing':['推断根因节点','Agent / Workflow','L5.2 ModelParamsResolver','模型请求参数（缺失字段以 Error Detail 为准）','Provider 收到缺少必填模型参数的请求','字段级错误明确指出必填参数缺失；节点为逻辑反推，非独立 Span'],
  'thinking_parameter_type_invalid':['推断根因节点','Agent / Workflow','L5.7 Parameter Resolver','thinking = map/object（具体 Payload 未完整记录）','目标 Provider 期望 boolean，Payload 反序列化失败','字段级错误明确指出实际类型与期望类型；节点为逻辑反推，非独立 Span']}
 if cat in inferred:rows.append(inferred[cat])
 error_ids=set(eg.id.dropna().astype(str)) if len(eg) and 'id' in eg else set()
 parent_ids=set(eg.parent_id.dropna().astype(str)) if len(eg) and 'parent_id' in eg else set()
 selected=g[g.id.astype(str).isin(error_ids|parent_ids)].sort_values('created_at') if len(g) else g
 for _,n in selected.iterrows():
  iserr=bool(n.is_error) or str(n.id) in error_ids
  if iserr:
   role='Assistant / Model' if n.role=='assistant' else ('Tool Output / Observation' if n.role=='tool' else 'Agent / Workflow')
   caller='User → Assistant / Model' if n.role=='assistant' else '上游 → 报错节点'
   inp=compact(n.tools,700) if n.role=='assistant' else ''
   out=err_detail(n.error) or compact(n.content,1400) or '源数据无有效模型输出'
   rows.append(['报错节点',role,caller,inp,out,'直接暴露失败'])
  else:
   rows.append(['关键上游',val(n.role) or 'Agent / Workflow','Agent / Workflow','',compact(n.content,1000) or '错误由下游节点暴露','向报错节点提供输入/上下文'])
 # Keep the human-readable chain short and remove duplicate repeated failures.
 dedup=[];seen=set()
 for x in rows:
  key=tuple(map(val,x))
  if key not in seen:seen.add(key);dedup.append(x)
 error_rows=[x for x in dedup if x[0]=='报错节点']
 if len(error_rows)>2:
  keep_errors={id(error_rows[0]),id(error_rows[-1])};dedup=[x for x in dedup if x[0]!='报错节点' or id(x) in keep_errors]
 final_output=(error_rows[-1][4] if error_rows else '无可用结果')
 dedup.append(['最终失败','Assistant / Model','上游错误 → 最终节点','',final_output,impact])
 for i,x in enumerate(dedup,1):
  vals=[i]+x
  fill=ERROR_FILL if x[0] in {'推断根因节点','报错节点'} else CONTEXT_FILL
  for j,v in enumerate(vals,1):ws.cell(row,j,v);ws.cell(row,j).fill=PatternFill('solid',fgColor=fill)
  ws.row_dimensions[row].height=max(30,min(105,25+max(len(val(v)) for v in vals)//70*15));row+=1
 return row

def add_audit(wb,no,den):
 ws=wb.create_sheet(f'CASE_{no:02d}_TRACE_AUDIT')
 keys=['created_at','role','is_error','retention_reason','provider','model','error_type','error_message','error_detail','content','reasoning','tool_names','tool_signals']
 ws.append(['证据节点序号']+keys)
 for i,n in enumerate(den['nodes'],1):ws.append([i]+[json.dumps(n[k],ensure_ascii=False) if isinstance(n[k],(list,dict)) else n[k] for k in keys])
 header(ws);ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
 widths=[12,21,15,10,28,16,24,22,38,55,55,45,30,55]
 for i,w in enumerate(widths,1):ws.column_dimensions[get_column_letter(i)].width=w

D=pd.DataFrame(json.loads(CLASSIFIED.read_text(encoding='utf-8')))
R=pd.read_excel(SRC,sheet_name='RAW_NODES');E=pd.read_excel(SRC,sheet_name='ERROR_EVENTS')
D=D[~(D.module_id.eq('L8.3')|D.badcase_kind.eq('observability_gap')|D.module_id.eq('UNCLASSIFIED'))].copy()
rank=D.groupby(['error_category','error_category_zh'],dropna=False).trace_id.nunique().reset_index(name='trace_count').sort_values(['trace_count','error_category'],ascending=[False,True]).head(5).reset_index(drop=True)
selected=[]
for _,x in rank.iterrows():
 s,a,rules,cr,sr=select_representative_trace(D[D.error_category.eq(x.error_category)],E,R)
 selected.append((x,s))
wb=Workbook();wb.remove(wb.active)
ov=wb.create_sheet('SAMPLE_OVERVIEW');ov.append(['Case','错误类别','Trace 数','占硬报错比例','Topic ID','能力层','具体模块','置信度'])
header(ov);total=D.trace_id.nunique()
for no,(x,s) in enumerate(selected,1):
 tid=s['trace_id'];rec=D[D.trace_id.eq(tid)].iloc[0];g=R[R.effective_trace_id.eq(tid)].sort_values('created_at').drop_duplicates('id',keep='last');eg=E[E.effective_trace_id.eq(tid)].sort_values('created_at');last=eg.iloc[-1] if len(eg) else None
 topic=next((val(v) for v in g.topic_id.dropna() if val(v).strip()),tid);user=g[g.role.eq('user')];task=compact(user.iloc[0].content,1500) if len(user) else '用户任务待确认'
 pct=round(x.trace_count/total*100,1);ov.append([no,x.error_category_zh,int(x.trace_count),f'{pct:.1f}%',topic,f"{rec.layer_id} {rec.layer_name}",f"{rec.module_id} {rec.module_name}",rec.confidence])
 ws=wb.create_sheet(f'CASE_{no:02d}');ws.sheet_view.showGridLines=False
 for c,w in {'A':18,'B':22,'C':24,'D':27,'E':34,'F':34,'G':38}.items():ws.column_dimensions[c].width=w
 reason=val(rec.reason);evidence=rec.evidence if isinstance(rec.evidence,list) else [val(rec.evidence)]
 conclusion=f"{rec.module_name} 发生“{x.error_category_zh}”，导致当前 Trace 任务失败。{reason}"
 error_message=val(last.error_message) if last is not None else '';detail=err_detail(last.error_raw) if last is not None else ''
 sections=[('1. Case 标识',[('错误类别',x.error_category_zh),('Case 序号',no),('Topic ID',topic),('Trace 时间',val(rec.trace_timestamp)),('类别 Trace 数',int(x.trace_count)),('占硬报错比例',f'{pct:.1f}%')]),('2. 一句话结论',[('结论',conclusion)]),('3. 用户任务',[('任务',task)]),('4. 最终影响',[('影响','任务因目标硬报错终止或未获得可用结果。')]),('5. 根因定位',[('根因节点',f"归因模块：{rec.module_id} {rec.module_name}"),('报错节点',f"{val(last.role) if last is not None else '待确认'} / Error Event"),('能力层',f"{rec.layer_id} {rec.layer_name}"),('具体模块',f"{rec.module_id} {rec.module_name}"),('归因置信度',rec.confidence)]),('6. 错误证据',[('错误信息',error_message or 'error_message 为空'),('Error Detail',detail),('归因证据',' | '.join(map(val,evidence)))]),('7. 精简调用链',[('调用链',f"用户请求 → 正常执行 → {rec.module_id} {rec.module_name} 首次异常 → 错误传播 → 最终失败")]),('8. 修复建议',[('立即修复',f"优先定位并修复 {rec.module_id} {rec.module_name} 中造成“{x.error_category_zh}”的直接原因。"),('防御性处理','在请求进入下游前增加契约校验、明确错误返回和安全重试边界。'),('监控与测试补充','补充该错误形态的字段级监控、回归测试和失败链路观测。')]),('9. 软错误观察项',[('观察项','主 Case 仅展示导致当前 Badcase 的硬报错；已恢复异常不计入。')])]
 row=1
 for title,items in sections:
  ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=7);ws.cell(row,1,title);header(ws,row);row+=1
  for k,v in items:
   ws.merge_cells(start_row=row,start_column=1,end_row=row,end_column=2);ws.cell(row,1,k).fill=PatternFill('solid',fgColor=LIGHT);ws.cell(row,1).font=Font(bold=True)
   ws.merge_cells(start_row=row,start_column=3,end_row=row,end_column=7);ws.cell(row,3,v);row+=1
  row+=1
 den=denoise_trace_nodes(g.to_dict('records'),max_nodes=40)
 row=add_evidence_chain(ws,row,g,eg,rec,task,'任务因目标硬报错终止或未获得可用结果。')
 add_rules(wb,no,den);add_audit(wb,no,den)
for ws in wb.worksheets:
 ws.sheet_view.showVerticalScroll=True;ws.sheet_view.showHorizontalScroll=True
 for row in ws.iter_rows():
  for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
 if ws.title=='SAMPLE_OVERVIEW':
  ws.freeze_panes='A2';ws.auto_filter.ref=ws.dimensions
  for col in ws.columns:
   vals=list(col);ws.column_dimensions[get_column_letter(vals[0].column)].width=min(36,max(12,max(len(val(c.value)) for c in vals)+2))
out=OUT/'top5_representative_cases.xlsx';wb.save(out)
print(json.dumps({'output':str(out),'top5':rank.to_dict('records'),'selected_trace_ids':[s['trace_id'] for _,s in selected],'sheets':wb.sheetnames},ensure_ascii=False,indent=2))
