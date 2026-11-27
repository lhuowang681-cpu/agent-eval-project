import json
from pathlib import Path
import pandas as pd
P=Path(r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx")
R=pd.read_excel(P,sheet_name='RAW_NODES'); E=pd.read_excel(P,sheet_name='ERROR_EVENTS')
rows=[]
for tid,eg in E.groupby('effective_trace_id'):
    eg=eg.sort_values('created_at'); g=R[R.effective_trace_id.eq(tid)].sort_values('created_at').drop_duplicates('id',keep='last')
    last_err=eg.iloc[-1]; after=g[g.created_at>last_err.created_at] if len(g) else g
    successful_after=after[(after.role.eq('assistant')) & (~after.is_error.fillna(False).astype(bool)) & after.content.fillna('').str.strip().ne('')]
    last=g.iloc[-1] if len(g) else None
    topic=next((str(x) for x in g.topic_id.dropna() if str(x).strip()),'')
    if not len(g): outcome='unknown_no_chain'
    elif len(successful_after): outcome='recovered_or_completed'
    elif bool(last.is_error): outcome='hard_failed'
    elif last.role=='assistant' and str(last.content or '').strip() and not bool(last.is_error): outcome='completed'
    else: outcome='unknown_incomplete'
    rows.append({'trace_id':tid,'topic_id':topic,'error_types':'|'.join(sorted(set(eg.error_type.dropna().astype(str)))),'error_count':len(eg),'node_count':len(g),'last_error_at':str(last_err.created_at),'after_assistant_success':len(successful_after),'last_role':getattr(last,'role',''),'last_is_error':bool(getattr(last,'is_error',False)) if last is not None else None,'last_content':str(getattr(last,'content',''))[:300] if last is not None else '', 'outcome':outcome})
d=pd.DataFrame(rows);d.to_csv('output/trace_outcome_audit.csv',index=False,encoding='utf-8-sig');print(d.outcome.value_counts().to_dict());print(d[d.outcome.eq('hard_failed')].head(30).to_json(force_ascii=True,orient='records'))
