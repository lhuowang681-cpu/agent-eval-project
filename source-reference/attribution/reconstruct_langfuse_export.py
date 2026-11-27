from openpyxl import load_workbook
from pathlib import Path
import re,json
src=Path(r'D:\Users\martinma\Downloads\exports_1785399723864-lf-traces-export-cmriyjwk705ge5x6adtw1osmu.xlsx')
out=Path(r'D:\Users\martinma\tripyoyo源码\langfuse_reconstructed_traces.jsonl')
ws=load_workbook(src,read_only=True,data_only=True).active
uuid_re=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',re.I)
cur=None;count=0
with out.open('w',encoding='utf-8') as f:
 for rn,row in enumerate(ws.iter_rows(values_only=True),1):
  vals=[str(x) for x in row if x is not None]
  if not vals:continue
  if uuid_re.match(vals[0]):
   if cur:
    f.write(json.dumps(cur,ensure_ascii=False)+'\n');count+=1
   # canonical columns are only reliable at the first physical row
   padded=list(row[:15])+[None]*max(0,15-len(row[:15]))
   cur={'id':str(padded[0]),'timestamp':str(padded[1] or ''),'name':str(padded[2] or ''),'userId':str(padded[3] or ''),'sessionId':str(padded[4] or ''),'release':str(padded[5] or ''),'environment':str(padded[7] or ''),'tags':str(padded[8] or ''),'bookmarked':bool(padded[9]),'public':bool(padded[10]),'parts':[str(x) for x in row[11:] if x is not None],'source_rows':[rn]}
  elif cur:
   cur['parts'].extend(vals);cur['source_rows'].append(rn)
 if cur:f.write(json.dumps(cur,ensure_ascii=False)+'\n');count+=1
print(json.dumps({'output':str(out),'logical_traces':count},ensure_ascii=False))
