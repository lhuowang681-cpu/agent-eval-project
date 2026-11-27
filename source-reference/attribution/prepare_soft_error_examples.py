import json,re
from pathlib import Path
import pandas as pd
P=Path(r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx")
R=pd.read_excel(P,sheet_name='RAW_NODES').sort_values(['effective_trace_id','created_at']).drop_duplicates('id',keep='last')
E=pd.read_excel(P,sheet_name='ERROR_EVENTS')
O=pd.read_csv('output/trace_outcome_audit.csv')
IDS=['tpc_A6iVTYMRUrW0','tpc_ko3VK8a6JpMj','tpc_F6fWMR6R562H']

def parse(v):
 try:
  x=json.loads(v) if isinstance(v,str) else {}
  return x if isinstance(x,dict) else {}
 except:return {}
def tool_call(v):
 try:
  x=json.loads(v); x=x[0] if isinstance(x,list) and x else x
  return {'tool':x.get('identifier') or x.get('apiName'),'api':x.get('apiName'),'input':x.get('arguments')} if isinstance(x,dict) else {}
 except:return {}
def clip(v,n=1200):
 if v is None or (isinstance(v,float) and pd.isna(v)):return ''
 s=str(v);return s if len(s)<=n else s[:n]+' [仅聊天预览；Excel源数据可回查]'
examples=[]
# Explicit known failure nodes and recovery evidence times
specs={
 'tpc_A6iVTYMRUrW0':[
  ('2026-07-21 16:11:58','Cloud Sandbox 不可用','后续改用飞书链接、粘贴数据等替代路径，Trace 继续执行；最终硬失败为 16:20:26 ConnectionAborted')],
 'tpc_ko3VK8a6JpMj':[
  ('2026-07-20 13:44:41','SQL 查询超时','后续切换 SPARK3/调整执行方式并取得查询结果；最终任务仍输出结果')],
 'tpc_F6fWMR6R562H':[
  ('2026-07-20 12:36:00','模型 Thinking 参数请求失败','后续改走搜索工具并生成科技新闻回答；最终任务完成')]
}
for tid in IDS:
 g=R[R.effective_trace_id.eq(tid)].reset_index(drop=True); outcome=O.loc[O.trace_id.eq(tid),'outcome'];outcome=outcome.iloc[0] if len(outcome) else ''
 topic=next((str(x) for x in g.topic_id.dropna() if str(x).strip()),tid)
 for timestr,label,recovery in specs[tid]:
  target=g[g.created_at.astype(str).eq(timestr)]
  if target.empty:continue
  n=target.iloc[0]; idx=int(target.index[0]); prev=g.iloc[idx-1] if idx>0 else None; later=g.iloc[idx+1:min(len(g),idx+5)]
  call=tool_call(prev.tools) if prev is not None and pd.notna(prev.tools) else {}
  examples.append({'topic_id':topic,'trace_id':tid,'trace_outcome':outcome,'soft_error':label,'failed_at':timestr,'caller_role':str(prev.role) if prev is not None else '','tool_or_api':call.get('tool') or call.get('api') or '模型请求','input':clip(call.get('input','')),'failure_output':clip(n.content if pd.notna(n.content) else n.error),'recovery_evidence':recovery,'later_nodes':json.dumps([{'time':str(x.created_at),'role':x.role,'content':clip(x.content,350)} for _,x in later.iterrows()],ensure_ascii=False),'formal_badcase_count':'不计入'})
Path('output/soft_error_examples.json').write_text(json.dumps(examples,ensure_ascii=False,indent=2),encoding='utf-8');pd.DataFrame(examples).to_excel('output/soft_error_examples.xlsx',index=False)
print(json.dumps([{'topic_id':x['topic_id'],'soft_error':x['soft_error'],'outcome':x['trace_outcome']} for x in examples],ensure_ascii=True))
