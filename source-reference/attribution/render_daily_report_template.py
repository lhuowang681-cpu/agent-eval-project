"""将 Agent 源码归因结果渲染到既有日报模板。

内容口径由新版 Skill 决定；工作簿结构、Sheet 顺序、Case 九段式布局、RULES、TRACE_AUDIT
和 00_CHARTS 四图布局由用户提供的日报模板决定。
"""
from __future__ import annotations
from pathlib import Path
import argparse, json, math, re, shutil, sys
from copy import copy
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib
from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XLImage
from openpyxl.styles import Alignment, PatternFill
from PIL import Image as PILImage

HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from cause_convergence import medoid
from langfuse_trace_recoverer import load_reconstructed,recover_events,denoise_for_signal
from generate_new_export_deliverable_v2 import select_module_top5,clean,human_error

RED='FEE4E2';YELLOW='FFF1CC';WHITE='FFFFFF'

def user_task(events):
 users=[clean(e.get('content',''),900) for e in events if e.get('role')=='user' and str(e.get('content','')).strip()]
 return users[-1] if users else '原始导出未保留可稳定提取的用户任务文本'

def impact_text(kind):
 return {'runtime_error':'该问题导致任务失败或阻断，需要修改 Agent 源码或运行链路。','quality_badcase':'任务可能完成，但输出质量或决策不符合预期。','performance_badcase':'任务存在重复调用、额外成本或时延问题。','recovered_with_capability_issue':'任务最终恢复，但异常处理产生了额外调用或用户等待。'}.get(str(kind),'具体影响以原始 Trace 为准。')

def fix_text(module,cat):
 if cat=='context_window_exceeded':return '优化消息截断、上下文预算和重复注入检测，在模型请求前执行窗口校验。'
 if cat=='provider_bad_request':return '在 Context Builder 发送前校验 Provider Payload、消息角色、内容块和 Tool Use/Result 配对。'
 if cat=='thinking_parameter_type_invalid':return '按 Provider/Model 能力表规范化 Thinking 参数类型，并执行发送前 Schema 校验。'
 if cat=='sql_unreplaced_variable':return 'Agent 生成工具参数后检查未解析模板变量；存在 ${...} 时禁止提交并要求补全。'
 if cat=='sql_timeout':return '仅在确认 Tool Call 输入有效后，补充超时分类、可重试性信号和受控降级；外部查询性能另行治理。'
 return f'针对 {module} 增加输入校验、状态断言、错误分类和回归测试。'

def copy_row_style(ws,src,dst,max_col):
 ws.row_dimensions[dst].height=ws.row_dimensions[src].height
 for c in range(1,max_col+1):
  a,b=ws.cell(src,c),ws.cell(dst,c)
  if a.has_style:
   b._style=copy(a._style);b.font=copy(a.font);b.fill=copy(a.fill);b.border=copy(a.border);b.alignment=copy(a.alignment);b.number_format=a.number_format;b.protection=copy(a.protection)

def fill_case(ws,no,r,rep,events,nodes):
 task=user_task(events);module=f'{r.module_id} {r.module_name}';issue=str(r.category_zh)
 basis=str(rep.get('attribution_basis') or f'错误虽在 {rep.get("error_exposure_node","")} 暴露，但开发责任按最早内部异常模块 {module} 判断。')
 signal=clean(rep.get('signal',''),900);context=human_error(rep.get('context','')) if rep.get('context') else '源数据未保留有效错误正文'
 conclusion=f'{issue}。{basis}'
 values={2:issue,3:no,4:rep.get('topic_id',''),5:rep.get('trace_id',''),8:conclusion,11:task,14:impact_text(rep.get('badcase_kind')),17:f'{str(r.module_id).split(".")[0]} 固定归因树能力层',18:module,19:issue,20:basis,21:f'影响 {int(r.trace_count)} 个去重用户任务',22:'中高（模块级查重、源码可改进性与证据完整度综合判断）',25:signal,26:context,29:'用户请求 → Agent 内部异常输入/状态 → 错误传播 → 报错暴露 → 最终影响',32:fix_text(module,str(r.category)),33:'增加发送/执行前校验、明确错误可重试性、熔断条件和安全降级路径。',34:'按模块和二级问题监控去重 Topic 数、硬失败、额外调用与修复回归结果。',37:'本 Case 进入开发榜前已按 module_id 查重；外部工具、SQL、用户环境和输入缺失问题已降权。'}
 for row,val in values.items():ws.cell(row,3).value=val
 # 固定四节点人类可读证据链，沿用模板 39-44 行。
 fail=next((e for e in nodes if e.get('is_error')),None)
 call=next((e for e in nodes if e.get('role')=='assistant' and e.get('name')),None)
 final=next((e for e in reversed(nodes) if e.get('role')=='assistant' and str(e.get('content','')).strip()),None)
 chain=[
  [1,'上下文','User','User → Assistant / Model',task,'','定义用户任务'],
  [2,'推断根因节点','Agent / Workflow',module,clean((call or {}).get('arguments',''),1200) or '内部异常输入/状态见 Trace',basis,'定位最早可由 Agent 源码改进的节点'],
  [3,'报错节点','Tool/Model Output','上游 → 报错节点','',human_error((fail or {}).get('content') or rep.get('context','')),'仅作为错误暴露位置，不自动等于主根因'],
  [4,'最终表现','Assistant / Model','异常传播 → 最终节点','',clean((final or {}).get('content',''),1200) or impact_text(rep.get('badcase_kind')),'确认任务失败、降级或恢复状态']]
 for rr in range(41,45):
  for c in range(1,8):ws.cell(rr,c).value=chain[rr-41][c-1]
  fill=RED if rr==43 else (YELLOW if rr==42 else WHITE)
  for c in range(1,8):ws.cell(rr,c).fill=PatternFill('solid',fgColor=fill);ws.cell(rr,c).alignment=Alignment(vertical='top',wrap_text=True)
 ws.row_dimensions[41].height=35;ws.row_dimensions[42].height=75;ws.row_dimensions[43].height=105;ws.row_dimensions[44].height=55

def fill_rules(ws,r,rep,raw_count,kept_count):
 rows=[('具体问题',r.category_zh),('代表 Topic ID',rep.get('topic_id','')),('问题覆盖面',f'影响 {int(r.trace_count)} 个去重用户任务'),('选择理由',f'先按 {r.module_id} 模块查重，再按源码可改进性、证据完整度、影响和频率选择该模块代表问题'),('数据来源',f'本次 Langfuse Trace 导出；恢复节点 {raw_count} 个，保留因果证据节点 {kept_count} 个')]
 for i,(a,b) in enumerate(rows,2):ws.cell(i,1).value=a;ws.cell(i,2).value=b

def fill_audit(ws,rep,nodes):
 max_row=max(ws.max_row,2)
 for r in range(2,max_row+1):
  for c in range(1,10):ws.cell(r,c).value=None
 for i,e in enumerate(nodes,2):
  if i>2:copy_row_style(ws,2,i,9)
  text=clean(e.get('content'));args=clean(e.get('arguments'));fail=bool(e.get('is_error'))
  kind='报错节点' if fail else ('工具调用' if e.get('role')=='assistant' and e.get('name') else ('上下文' if e.get('role')=='user' else ('工具结果' if e.get('role')=='tool' else '模型输出')))
  output=human_error(text) if fail else text
  effect='错误暴露节点，不自动等于 Agent 根因' if fail else ('内部异常输入候选' if args else '因果上下文')
  vals=[i-1,kind,e.get('role',''),e.get('name',''),args,output,effect,rep.get('trace_id',''),rep.get('topic_id','')]
  for c,v in enumerate(vals,1):ws.cell(i,c).value=v;ws.cell(i,c).alignment=Alignment(vertical='top',wrap_text=True)
  ws.row_dimensions[i].height=max(28,min(105,28+max(len(args),len(output))//100*14))
 ws.freeze_panes='A2';ws.auto_filter.ref=f'A1:I{max(1,len(nodes)+1)}'

def save_bar(data,label,value,path,color='#1570EF'):
 fig,ax=plt.subplots(figsize=(12,6));p=data.iloc[::-1];bars=ax.barh(p[label],p[value],color=color)
 for b,v in zip(bars,p[value]):ax.text(b.get_width()+.05,b.get_y()+b.get_height()/2,str(int(v)),va='center',fontweight='bold')
 ax.spines[['top','right','left']].set_visible(False);ax.grid(axis='x',alpha=.15);plt.tight_layout();fig.savefig(path,dpi=180,bbox_inches='tight');plt.close(fig)

def charts(wb,out,internal,external,rank):
 matplotlib.rcParams['font.family']=['Microsoft YaHei','SimHei','Arial Unicode MS']
 c1=out/'chart_top5_modules.png';q=rank.assign(label=rank.module_id+' '+rank.module_name);save_bar(q,'label','trace_count',c1)
 c2=out/'chart_module_distribution.png';q2=internal.groupby(['module_id','module_name']).topic_id.nunique().reset_index(name='topics').sort_values('topics',ascending=False);q2['label']=q2.module_id+' '+q2.module_name;save_bar(q2,'label','topics',c2,'#7A5AF8')
 c3=out/'chart_impact_distribution.png';q3=internal.groupby('badcase_kind').topic_id.nunique().reset_index(name='topics').sort_values('topics',ascending=False);save_bar(q3,'badcase_kind','topics',c3,'#12B76A')
 labels=['Agent内部源码候选','外部/配置/归因治理'];vals=[internal.topic_id.nunique(),external.topic_id.nunique()];fig,ax=plt.subplots(figsize=(10,6));ax.pie(vals,labels=labels,autopct='%1.1f%%',colors=['#1570EF','#D0D5DD'],startangle=90);plt.tight_layout();c4=out/'chart_responsibility_split.png';fig.savefig(c4,dpi=180,bbox_inches='tight');plt.close(fig)
 ws=wb['00_CHARTS'];ws._images=[]
 for src,anchor,lim in zip([c1,c3,c2,c4],['B3','V3','B48','V48'],[(1180,570),(1080,570),(1180,600),(1080,600)]):
  im=PILImage.open(src);scale=min(lim[0]/im.width,lim[1]/im.height);xl=XLImage(str(src));xl.width=int(im.width*scale);xl.height=int(im.height*scale);ws.add_image(xl,anchor)

def main():
 p=argparse.ArgumentParser();p.add_argument('--template',required=True);p.add_argument('--root',required=True);p.add_argument('--classified-internal',required=True);p.add_argument('--classified-external',required=True);p.add_argument('--traces',default='langfuse_reconstructed_traces.jsonl');p.add_argument('--output',required=True);a=p.parse_args()
 root=Path(a.root);out=Path(a.output);out.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(a.template,out)
 internal=pd.read_csv(a.classified_internal);external=pd.read_csv(a.classified_external);rank,_=select_module_top5(internal)
 ids=set(internal.trace_id.astype(str));store=load_reconstructed(root/a.traces,ids)
 selected=[]
 for no,r in enumerate(rank.itertuples(),1):
  # 代表 Case 必须与排名行的模块、二级问题和影响状态完全一致，避免硬失败统计误选已恢复 Trace。
  rows=internal[(internal.category==r.category)&(internal.module_id==r.module_id)&(internal.badcase_kind==r.badcase_kind)].to_dict('records');rep,_=medoid(rows,'context');selected.append((no,r,rep))
 wb=load_workbook(out)
 expected=['00_CHARTS','SAMPLE_OVERVIEW']+[x for i in range(1,6) for x in [f'CASE_{i:02d}',f'CASE_{i:02d}_RULES',f'CASE_{i:02d}_TRACE_AUDIT']]
 if wb.sheetnames!=expected:raise RuntimeError(f'模板 Sheet 结构不符合预期: {wb.sheetnames}')
 ov=wb['SAMPLE_OVERVIEW'];headers=['Case','类别排名','问题类别','类别 Topic 数','覆盖内部源码问题 Topic','具体问题','问题覆盖面','代表 Topic ID','影响状态','责任模块']
 for c,v in enumerate(headers,1):ov.cell(1,c).value=v
 # 先清空模板历史数据，避免合格模块不足5个时残留旧 Case。
 for rr in range(2,7):
  for cc in range(1,11):ov.cell(rr,cc).value=None
 for no,r,rep in selected:
  vals=[no,no,f'{r.module_id} {r.module_name}',int(r.trace_count),f'{r.pct:.1f}%',r.category_zh,f'影响 {int(r.trace_count)} 个去重 Topic',rep.get('topic_id',''),impact_text(rep.get('badcase_kind')),f'{r.module_id} {r.module_name}']
  for c,v in enumerate(vals,1):ov.cell(no+1,c).value=v
  events=recover_events(store.get(str(rep['trace_id']),{}));nodes,_,_=denoise_for_signal(events,rep.get('signal',''))
  fill_case(wb[f'CASE_{no:02d}'],no,r,rep,events,nodes);fill_rules(wb[f'CASE_{no:02d}_RULES'],r,rep,len(events),len(nodes));fill_audit(wb[f'CASE_{no:02d}_TRACE_AUDIT'],rep,nodes)
 # 空余席位必须明确标记，不得残留模板历史 Case，也不得用外部问题凑满5项。
 for no in range(len(selected)+1,6):
  ws=wb[f'CASE_{no:02d}'];ws.cell(2,3).value='本批次无更多合格 Agent 内部源码模块';ws.cell(3,3).value=no;ws.cell(4,3).value='';ws.cell(5,3).value='';ws.cell(8,3).value='未使用 MCP、外部依赖或归因治理项补位。';ws.cell(11,3).value='';ws.cell(14,3).value='';ws.cell(18,3).value='';ws.cell(19,3).value='';ws.cell(20,3).value='开发榜仅展示通过证据契约且 tool_source=builtin/provider_runtime 的内部问题。';ws.cell(21,3).value='0 个去重 Topic';ws.cell(22,3).value='不适用';ws.cell(25,3).value='';ws.cell(26,3).value='';ws.cell(32,3).value='';ws.cell(37,3).value='空余席位，不计入 Top 5。'
  ru=wb[f'CASE_{no:02d}_RULES'];ru.cell(2,1).value='状态';ru.cell(2,2).value='无合格内部模块';ru.cell(3,1).value='外部工具规则';ru.cell(3,2).value='MCP/Plugin/Unknown 一律分流外部';ru.cell(4,1).value='补位规则';ru.cell(4,2).value='禁止用外部或治理问题补位';ru.cell(5,1).value='统计单位';ru.cell(5,2).value='去重 Topic';ru.cell(6,1).value='数据来源';ru.cell(6,2).value='本次结构化 JSONL 扫描'
  au=wb[f'CASE_{no:02d}_TRACE_AUDIT'];
  for rr in range(2,au.max_row+1):
   for cc in range(1,10):au.cell(rr,cc).value=None
  au.auto_filter.ref='A1:I1'
 charts(wb,out.parent,internal,external,rank);wb.save(out)
 print(json.dumps({'output':str(out),'sheets':len(wb.sheetnames),'top5_modules':[x.module_id for x in rank.itertuples()]},ensure_ascii=False))
if __name__=='__main__':main()
