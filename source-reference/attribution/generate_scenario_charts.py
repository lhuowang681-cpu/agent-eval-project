from pathlib import Path
import json,re
import pandas as pd
import matplotlib
import matplotlib.pyplot as plt
ROOT=Path(__file__).resolve().parent
SRC=Path(r'D:\Users\martinma\Downloads\TripYoYo_Error_Traces_20260720_20260727.xlsx')
CLASSIFIED=ROOT/'output/real_analysis/classified_badcases.json'
OUTCOME=ROOT/'output/trace_outcome_audit.csv'
SOFT=ROOT/'output/capability_issue_analysis/soft_errors/soft_error_details.csv'
OUT=ROOT/'output/scenario_analysis';OUT.mkdir(parents=True,exist_ok=True)
SCENARIOS=['Skill工作流','纯问答与多轮文本','联网研究','其他原生工具','任务与子Agent','文档报告','文件与代码','用户记忆','知识库RAG']
def txt(v):return '' if v is None or (isinstance(v,float) and pd.isna(v)) else str(v)
def scene(trace):
 s=' '.join((trace.content.fillna('').astype(str)+' '+trace.tools.fillna('').astype(str)+' '+trace.reasoning.fillna('').astype(str)).tolist()).lower()
 # Mutually exclusive priority: specialized workflows first, generic tool/text last.
 rules=[
 ('任务与子Agent',r'exectask|exectasks|callsubagent|sub.?agent|子agent|子 agent|异步任务|task runtime|agent tasks'),
 ('用户记忆',r'searchusermemory|addpreferencememory|addcontextmemory|addactivitymemory|addexperiencememory|用户记忆|memory search|memory write'),
 ('知识库RAG',r'knowledge.?base|知识库|rag|embedding|vector search|lobe-knowledge-base'),
 ('联网研究',r'web.?brows|crawl(single|multi)|search____builtin|网络搜索|联网研究|google|baidu|bing|duckduckgo'),
 ('Skill工作流',r'lobe-skills|activateskill|readreference|skill工作流|selected_skill|skill runtime'),
 ('文档报告',r'\.docx|\.pptx|\.pdf|报告|文档|飞书文档|create.?doc|word|powerpoint|spreadsheet report'),
 ('文件与代码',r'runcommand|executecode|local.?system|cloud.?sandbox|\.py\b|\.js\b|\.ts\b|代码|文件|excel|xlsx|csv'),
 ('其他原生工具',r'tool|mcp|plugin|工具调用|builtin'),
 ]
 for name,p in rules:
  if re.search(p,s,re.I):return name
 return '纯问答与多轮文本'
def actionability(cat,mid,reason):
 external={'stream_connection_aborted','provider_gateway_timeout','provider_rate_limited','mcp_oauth_token_expired','provider_content_safety_rejected'}
 dependency={'subscription_budget_limit_reached','provider_credential_binding_missing','provider_model_permission_denied','coding_plan_unavailable','model_not_found','insufficient_quota'}
 if mid=='L8.3' or cat=='unclassified_runtime_error':return '归因治理'
 if cat in external or re.search(r'network error|econnreset|premature close|gateway|upstream timeout|rate.?limit|engine overloaded|grant token has expired',reason,re.I):return '外部不可控'
 if cat in dependency or mid in {'L2.4','L8.2','L8.6'} or re.search(r'预算|费用上限|quota|credential|凭证|no binding|permission|权限|coding plan|api key|token expired',reason,re.I):return '非编排依赖'
 return 'Agent编排内可解决'
raw=pd.read_excel(SRC,sheet_name='RAW_NODES');groups={str(k):g for k,g in raw.groupby('effective_trace_id')};scene_map={k:scene(g) for k,g in groups.items()}
c=pd.DataFrame(json.loads(CLASSIFIED.read_text(encoding='utf-8')));o=pd.read_csv(OUTCOME,encoding='utf-8-sig');outcome=dict(zip(o.trace_id.astype(str),o.outcome));rows=[]
for _,r in c.iterrows():
 a=actionability(txt(r.error_category),txt(r.module_id),txt(r.reason))
 if a!='Agent编排内可解决':continue
 rows.append({'trace_id':str(r.trace_id),'scene':scene_map.get(str(r.trace_id),'纯问答与多轮文本'),'issue_category':r.error_category,'issue_category_zh':r.error_category_zh,'module_id':r.module_id,'module_name':r.module_name,'impact':'硬失败（任务最终失败）' if outcome.get(str(r.trace_id))=='hard_failed' else '已恢复但存在能力问题'})
# Add recovered semantic tool problems.
s=pd.read_csv(SOFT,encoding='utf-8-sig')
for _,r in s.iterrows():
 rows.append({'trace_id':str(r.trace_id),'scene':scene_map.get(str(r.trace_id),'纯问答与多轮文本'),'issue_category':r.soft_error_category,'issue_category_zh':r.soft_error_category_zh,'module_id':r.module_id,'module_name':r.module_name,'impact':'已恢复但存在能力问题'})
d=pd.DataFrame(rows).drop_duplicates(['trace_id','issue_category'])
d.to_csv(OUT/'scenario_issue_details.csv',index=False,encoding='utf-8-sig')
stat=d.groupby('scene').trace_id.nunique().reindex(SCENARIOS,fill_value=0).reset_index(name='trace_count');stat.to_csv(OUT/'scenario_trace_counts.csv',index=False,encoding='utf-8-sig')
cross=d.groupby(['scene','issue_category_zh']).trace_id.nunique().reset_index(name='trace_count');cross.to_csv(OUT/'scenario_issue_category_counts.csv',index=False,encoding='utf-8-sig')
for f in ['Microsoft YaHei','SimHei','Arial Unicode MS']:matplotlib.rcParams['font.family']=f;break
matplotlib.rcParams['axes.unicode_minus']=False
colors=['#1570EF','#7A5AF8','#12B76A','#F79009','#D92D20','#06AED4','#EE46BC','#6172F3','#039855','#DC6803']
# Chart 1: scenario problem Trace count
p=stat.sort_values('trace_count');fig,ax=plt.subplots(figsize=(12,6.5));bars=ax.barh(p.scene,p.trace_count,color='#1570EF')
for b,v in zip(bars,p.trace_count):ax.text(b.get_width()+.3,b.get_y()+b.get_height()/2,str(int(v)),va='center',fontweight='bold')
ax.set_xlabel('问题 Trace 数');ax.spines[['top','right','left']].set_visible(False);ax.grid(axis='x',alpha=.15);plt.tight_layout();fig.savefig(OUT/'01_scenario_issue_trace_count.png',dpi=180,bbox_inches='tight',facecolor='white');plt.close(fig)
# Chart 2: scenario x issue category, use overall Top 8 categories to keep readable.
topcats=d.groupby('issue_category_zh').trace_id.nunique().sort_values(ascending=False).head(8).index.tolist();pivot=cross[cross.issue_category_zh.isin(topcats)].pivot(index='scene',columns='issue_category_zh',values='trace_count').fillna(0).reindex(SCENARIOS,fill_value=0)
fig,ax=plt.subplots(figsize=(15,7.5));left=pd.Series(0,index=pivot.index,dtype=float)
for i,cat in enumerate(pivot.columns):
 vals=pivot[cat];ax.barh(pivot.index,vals,left=left,label=cat,color=colors[i%len(colors)])
 for y,(l,v) in enumerate(zip(left,vals)):
  if v>0:ax.text(l+v/2,y,str(int(v)),ha='center',va='center',fontsize=8,color='white',fontweight='bold')
 left=left+vals
ax.set_xlabel('问题 Trace 数');ax.legend(loc='upper center',bbox_to_anchor=(.5,-.1),ncol=4,frameon=False);ax.spines[['top','right','left']].set_visible(False);ax.grid(axis='x',alpha=.12);plt.tight_layout();fig.savefig(OUT/'02_scenario_issue_category_distribution.png',dpi=180,bbox_inches='tight',facecolor='white');plt.close(fig)
print(json.dumps({'issue_records':len(d),'issue_traces':d.trace_id.nunique(),'scene_counts':stat.to_dict('records'),'top_issue_categories':topcats,'chart1':str(OUT/'01_scenario_issue_trace_count.png'),'chart2':str(OUT/'02_scenario_issue_category_distribution.png')},ensure_ascii=False,indent=2))
