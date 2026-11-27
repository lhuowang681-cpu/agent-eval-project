import json
from pathlib import Path
import pandas as pd
P=Path(r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx")
R=pd.read_excel(P,sheet_name='RAW_NODES'); E=pd.read_excel(P,sheet_name='ERROR_EVENTS')
CASES=[('模型流连接中断','tpc_ko3VK8a6JpMj'),('Provider凭证绑定缺失','tpc_34KBtXO6jSPK'),('Thinking参数类型错误','tpc_F6fWMR6R562H')]
out=[]
for label,tid in CASES:
 g=R[R.effective_trace_id.eq(tid)].sort_values('created_at').drop_duplicates('id',keep='last')
 e=E[E.effective_trace_id.eq(tid)].sort_values('created_at')
 topics=[str(x) for x in g.topic_id.dropna().unique()]
 errs=[]
 for _,x in e.iterrows():
  errs.append({'time':str(x.created_at),'node_id':x.id,'parent_id':x.parent_id,'error_type':x.error_type,'error_message':x.error_message,'error_raw':str(x.error_raw)[:1800],'provider':x.provider,'model':x.model,'content':str(x.content)[:500]})
 # compact useful nodes: user + error + parent + last node
 ids=set(e.id.dropna().astype(str)); parent_ids=set(e.parent_id.dropna().astype(str)); useful=g[g.id.astype(str).isin(ids|parent_ids)]
 user=g[g.role.eq('user')].head(1)
 tail=g.tail(3)
 nodes=pd.concat([user,useful,tail]).drop_duplicates('id').sort_values('created_at')
 n=[]
 for _,x in nodes.iterrows():
  n.append({'time':str(x.created_at),'role':x.role,'node_id':x.id,'parent_id':x.parent_id,'is_error':x.is_error,'content':str(x.content)[:800],'tools':str(x.tools)[:800],'error':str(x.error)[:1200]})
 out.append({'label':label,'trace_id':tid,'topic_ids':topics,'node_count':len(g),'role_counts':g.role.value_counts().to_dict(),'errors':errs,'useful_nodes':n,'last_node':n[-1] if n else {}})
Path('output/three_case_source.json').write_text(json.dumps(out,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{'label':x['label'],'trace_id':x['trace_id'],'topics':x['topic_ids'],'nodes':x['node_count'],'errors':len(x['errors'])} for x in out],ensure_ascii=True))
