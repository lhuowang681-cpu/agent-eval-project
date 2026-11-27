"""新版 Langfuse 导出报告入口：多问题发现、内部根因优先与责任边界分流。

它不再维护 7 类 MAP。输入必须由 scan_new_export_precise.py + refine_new_export_categories.py 生成。
"""
from pathlib import Path
import argparse,json,sys
import pandas as pd
from openpyxl import Workbook
from openpyxl.styles import Alignment,Font,PatternFill
from openpyxl.utils import get_column_letter

HERE=Path(__file__).resolve().parent;sys.path.insert(0,str(HERE))
from cause_convergence import medoid
from langfuse_trace_recoverer import load_reconstructed,recover_events,denoise_for_signal,candidate_evidence
from development_priority import calculate_priority

BLUE='1F4E78';WHITE='FFFFFF';LIGHT='D9EAF7';RED='FEE4E2';YELLOW='FFF1CC'
def header(ws,row=1):
 for c in ws[row]:c.fill=PatternFill('solid',fgColor=BLUE);c.font=Font(color=WHITE,bold=True);c.alignment=Alignment(horizontal='center',vertical='center',wrap_text=True)
def clean(v,n=2200):
 s=' '.join(str(v or '').replace('\\n',' ').replace('\\r',' ').split());return s[:n]+('…[已截断]' if len(s)>n else '')
def human_error(v):
 s=clean(v,5000);parts=['执行状态：失败']
 import re
 status=re.search(r'currentStatus["\\\s:|]+([A-Z_]+)',s,re.I);etype=re.search(r'([A-Za-z][A-Za-z0-9_.]*(?:Exception|Error))',s)
 msg=re.search(r'(SQL execution failed:.{0,700}|ToolExecutionError.{0,700}|Unexpected token.{0,500}|No binding found.{0,500}|ExceededContextWindow.{0,500})',s,re.I)
 if status:parts.append('工具状态：'+status.group(1))
 if etype:parts.append('错误类型：'+etype.group(1).split('.')[-1])
 if msg:parts.append('错误摘要：'+msg.group(1))
 parts.append('错误暴露位置不等于主根因；请结合“异常输入来源”和前序调用判断责任模块。')
 return '\n'.join(parts)

def select_module_top5(internal):
 """按完整 56 模块先验和 45/30/15/10 四维公式算分，再按 module_id 查重。"""
 keys=['module_id','module_name','category','category_zh','badcase_kind']
 counts=internal.groupby(keys,dropna=False).topic_id.nunique().reset_index(name='trace_count')
 # 为每个模块+二级问题选择证据最完整的一条记录作为评分载体，并附加去重 Topic 数。
 samples=[]
 for r in counts.itertuples(index=False):
  q=internal[(internal.module_id==r.module_id)&(internal.category==r.category)&(internal.badcase_kind==r.badcase_kind)].copy()
  rep=q.iloc[0].to_dict();rep.update({k:getattr(r,k) for k in keys});rep['trace_count']=r.trace_count;samples.append(rep)
 issue=pd.DataFrame(samples);max_topics=max(1,int(issue.trace_count.max()))
 dimensions=issue.apply(lambda x:pd.Series(calculate_priority(x.to_dict(),max_topics)),axis=1)
 issue=pd.concat([issue.reset_index(drop=True),dimensions.reset_index(drop=True)],axis=1)
 # 开发榜只保留正式合格的内部源码项；不足5个时不再用 MCP/外部/治理项补位。
 qualified=issue[issue.eligible_for_dev_ranking.astype(bool)].copy()
 qualified=qualified.sort_values(['module_id','development_score','trace_count','category'],ascending=[True,False,False,True])
 representatives=qualified.drop_duplicates('module_id',keep='first').copy()
 representatives=representatives.sort_values(['development_score','trace_count','module_id'],ascending=[False,False,True]).head(5).reset_index(drop=True)
 representatives['pct']=(representatives.trace_count/internal.topic_id.nunique()*100).round(1) if len(representatives) else pd.Series(dtype=float)
 issue=issue.sort_values(['eligible_for_dev_ranking','development_score','trace_count'],ascending=[False,False,False])
 return representatives,issue

def add_quality_candidates(df,store):
 extra=[];existing={(str(r.trace_id),r.category) for r in df.itertuples()}
 for tid,tr in store.items():
  events=recover_events(tr)
  for q in candidate_evidence(events):
   if (tid,q['category']) in existing:continue
   extra.append({'trace_id':tid,'topic_id':tr.get('sessionId') or tid,'timestamp':tr.get('timestamp',''),'signal':q['evidence'],'context':q['evidence'],
    **q,'layer_id':q['module_id'].split('.')[0],'layer_name':'Agent 编排层','actionability':'agent_orchestration_actionable',
    'error_exposure_node':'行为序列','abnormal_input_source':'Agent 决策或恢复策略','attribution_basis':'根据完整调用序列识别质量/性能候选；需结合最终状态复核。','candidate_modules':[],'needs_causal_review':q.get('needs_review',False)})
 return pd.concat([df,pd.DataFrame(extra)],ignore_index=True) if extra else df

def main():
 p=argparse.ArgumentParser();p.add_argument('--root',default=str(HERE.parents[1]));p.add_argument('--input',default='new_export_refined.json');p.add_argument('--traces',default='langfuse_reconstructed_traces.jsonl');p.add_argument('--output-dir',default='new_export_output_v2');a=p.parse_args()
 root=Path(a.root);out=root/a.output_dir;out.mkdir(parents=True,exist_ok=True)
 d=pd.DataFrame(json.loads((root/a.input).read_text(encoding='utf-8')))
 # 大型 JSONL 只加载已发现候选问题涉及的 Trace，避免把数 GB 全量内容驻留内存。
 store=load_reconstructed(root/a.traces,set(d.trace_id.astype(str)))
 # 质量/性能候选检测只在已纳入候选池的 Trace 内执行；全量质量扫描应由上游流式扫描器完成。
 d=add_quality_candidates(d,store)
 d['badcase_kind']=d.get('badcase_kind',pd.Series(index=d.index,dtype=object)).fillna('runtime_error')
 # 待人工复核的启发式质量候选保留在明细，但不进入正式开发 Top5。
 internal=d[(d.actionability=='agent_orchestration_actionable') & (~d.get('needs_causal_review',False).fillna(False).astype(bool))].copy()
 external=d[~d.index.isin(internal.index)].copy()
 external.loc[(external.actionability=='agent_orchestration_actionable') & (external.get('needs_causal_review',False).fillna(False).astype(bool)),'actionability']='attribution_governance'
 if internal.empty:raise RuntimeError('没有 internal actionable 记录，不能生成开发 Top5')
 rank,raw_issue_ranking=select_module_top5(internal)
 selected=[]
 for no,r in enumerate(rank.itertuples(),1):
  rows=internal[(internal.category==r.category)&(internal.module_id==r.module_id)].to_dict('records');rep,_=medoid(rows,'context');selected.append((no,r,rep))
 wb=Workbook();wb.remove(wb.active)
 ov=wb.create_sheet('SAMPLE_OVERVIEW');ov.append(['Case','归因树一级模块','模块代表二级问题','类别 Topic 数','占内部可解决 Topic','影响类型','开发优先分','开发榜资格','异常输入来源','代表 Topic ID']);header(ov)
 for no,r,rep in selected:ov.append([no,f'{r.module_id} {r.module_name}',r.category_zh,r.trace_count,f'{r.pct:.1f}%',rep.get('badcase_kind','runtime_error'),r.development_score,'正式开发项' if r.eligible_for_dev_ranking else '低置信度边界候选',rep.get('abnormal_input_source',''),rep['topic_id']])
 for no,r,rep in selected:
  events=recover_events(store.get(rep['trace_id'],{}));nodes,_,_=denoise_for_signal(events,rep.get('signal',''))
  ws=wb.create_sheet(f'CASE_{no:02d}');rows=[('问题类别',r.category_zh),('Topic ID',rep['topic_id']),('Trace ID',rep['trace_id']),('影响类型',rep.get('badcase_kind','runtime_error')),('主根因模块',f'{r.module_id} {r.module_name}'),('错误暴露位置',rep.get('error_exposure_node','')),('异常输入来源',rep.get('abnormal_input_source','')),('主归因依据',rep.get('attribution_basis','')),('候选模块',','.join(rep.get('candidate_modules',[])))]
  ws.append(['字段','内容']);header(ws)
  for x in rows:ws.append(x)
  ws.column_dimensions['A'].width=24;ws.column_dimensions['B'].width=110
  ru=wb.create_sheet(f'CASE_{no:02d}_RULES');ru.append(['规则','说明']);header(ru)
  for x in [('模块级查重','开发 Top5 先按固定归因树 module_id 查重，每个模块最多一个席位；模块内选开发优先分最高的二级问题。'),('统一权重公式','开发优先分=源码可解决性45%+内部证据完整度30%+用户影响15%+去重Topic频率10%；模块先验覆盖全部8层56模块。'),('开发优先于频率','排序优先考虑 Agent 源码可改进性和证据完整度，频率只占10%。'),('外部信息降权','Tool/MCP/SQL、用户电脑环境或输入来源无法还原的问题显著降权，不因高频占据开发榜。'),('内部代码提权','上下文窗口、Payload 构造、参数转换、状态/事件、结果回填等明确可修改 Agent 源码的问题显著提权。'),('根因与报错分离','MCP/Tool/Provider 返回 Error 仅作为错误暴露节点；先检查 Tool Call 前是否已有错误参数、SQL、工具选择或上下文。'),('责任边界','仅 internal actionable 进入开发 Top5；依赖、外部问题和归因治理单列。')]:ru.append(x)
  ru.column_dimensions['A'].width=22;ru.column_dimensions['B'].width=110
  au=wb.create_sheet(f'CASE_{no:02d}_TRACE_AUDIT');au.append(['序号','节点性质','角色','工具名称','关键输入','人类可读关键输出','因果作用','Trace ID','Topic ID']);header(au)
  for i,e in enumerate(nodes,1):
   text=clean(e.get('content'));args=clean(e.get('arguments'));fail=bool(e.get('is_error'))
   kind='报错节点' if fail else ('工具调用' if e['role']=='assistant' and e.get('name') else ('上下文' if e['role']=='user' else ('工具结果' if e['role']=='tool' else '模型输出')))
   display=human_error(text) if fail else text;effect='暴露错误，不自动等于主根因' if fail else ('异常输入候选' if args else '因果上下文')
   au.append([i,kind,e['role'],e.get('name',''),args,display,effect,rep['trace_id'],rep['topic_id']])
  for i,w in enumerate([10,18,14,38,60,75,30,38,24],1):au.column_dimensions[get_column_letter(i)].width=w
  for row in au.iter_rows():
   for c in row:c.alignment=Alignment(vertical='top',wrap_text=True)
  au.freeze_panes='A2'
 # 保留未做模块查重的原始二级问题排名，仅用于审计为何被模块级 Top5 去重。
 audit=wb.create_sheet('RAW_ISSUE_RANKING');audit.append(['模块ID','模块名','二级问题','Topic数','模块先验','源码可解决性','证据完整度','用户影响','频率','开发优先分','是否合格','是否模块代表']);header(audit)
 winners={(str(x.module_id),str(x.category)) for x in rank.itertuples()}
 for x in raw_issue_ranking.itertuples():audit.append([x.module_id,x.module_name,x.category_zh,x.trace_count,x.module_prior,x.actionability_score,x.evidence_score,x.impact_score,x.frequency_score,x.development_score,'是' if x.eligible_for_dev_ranking else '否','是' if (str(x.module_id),str(x.category)) in winners else '否'])
 # 分流页不混入开发 Top5。
 for sheet_name,action in [('NON_ORCHESTRATION_DEPENDENCY','non_orchestration_dependency'),('EXTERNAL_UNCONTROLLABLE','external_uncontrollable'),('ATTRIBUTION_GOVERNANCE','attribution_governance')]:
  ws=wb.create_sheet(sheet_name);ws.append(['问题类别','Topic 数','模块','说明']);header(ws);q=external[external.actionability==action]
  for z in q.groupby(['category_zh','module_id','module_name']).topic_id.nunique().reset_index(name='topics').itertuples():ws.append([z.category_zh,z.topics,f'{z.module_id} {z.module_name}','不进入开发 Top5'])
 internal.to_csv(out/'classified_internal_actionable.csv',index=False,encoding='utf-8-sig');external.to_csv(out/'classified_non_internal.csv',index=False,encoding='utf-8-sig')
 path=out/'agent_badcase_attribution_v2.xlsx';wb.save(path)
 print(json.dumps({'output':str(path),'all_records':len(d),'internal_records':len(internal),'external_records':len(external),'categories':d.category.nunique(),'internal_categories':internal.category.nunique(),'modules':d.module_id.nunique(),'sheets':len(wb.sheetnames)},ensure_ascii=False))
if __name__=='__main__':main()
