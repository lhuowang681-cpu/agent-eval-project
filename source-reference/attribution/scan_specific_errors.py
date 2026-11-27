import openpyxl,re,json,collections
p=r'D:\Users\martinma\Downloads\exports_1785399723864-lf-traces-export-cmriyjwk705ge5x6adtw1osmu.xlsx'
out=r'D:\Users\martinma\tripyoyo源码\specific_error_scan.json'
w=openpyxl.load_workbook(p,read_only=True,data_only=True); s=w.active
uid=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',re.I)
patterns={
'PetaAuthError':re.compile(r'PetaAuthError',re.I),
'ConnectionAborted':re.compile(r'ConnectionAborted|connection aborted|network error',re.I),
'ExceededContextWindow':re.compile(r'ExceededContextWindow|context window exceeded|maximum context length',re.I),
'ToolExecutionError':re.compile(r'ToolExecutionError',re.I),
'ProviderError':re.compile(r'ProviderError|BadRequestError|InternalServerError',re.I),
'HTTP_error':re.compile(r'\b(?:HTTP\s*)?[45]\d\d\b.{0,80}(?:error|failed|unauthorized|forbidden)|(?:error|failed|unauthorized|forbidden).{0,80}\b[45]\d\d\b',re.I),
'explicit_error_json':re.compile(r'["\\](?:is_error|isError)["\\]\s*:\s*true|["\\](?:status)["\\]\s*:\s*["\\](?:error|failed)',re.I),
'exception_signature':re.compile(r'\b(?:TypeError|ValueError|KeyError|JSONDecodeError|ValidationError|TimeoutError|AbortError)\b',re.I),
}
blocks=[]; cur=None
for vals in s.iter_rows(min_row=2,values_only=True):
    cells=['' if v is None else str(v) for v in vals if v is not None]
    if not cells: continue
    if uid.match(cells[0].strip()):
        if cur: blocks.append(cur)
        cur={'id':cells[0].strip(),'timestamp':cells[1] if len(cells)>1 else '', 'sessionId':cells[4] if len(cells)>4 else '', 'head':cells[:15], 'text':' | '.join(cells[11:])}
    elif cur: cur['text']+='\n'+' | '.join(cells)
if cur: blocks.append(cur)
w.close()
res=[]; counts=collections.Counter()
for b in blocks:
    matches=[]
    for name,pat in patterns.items():
        found=list(pat.finditer(b['text']))
        if found:
            counts[name]+=1
            for m in found[-3:]:
                matches.append({'type':name,'snippet':b['text'][max(0,m.start()-500):m.start()+1600].replace('\n',' ')})
    if matches: res.append({'id':b['id'],'timestamp':b['timestamp'],'sessionId':b['sessionId'],'matches':matches[-12:]})
with open(out,'w',encoding='utf-8') as f: json.dump({'trace_blocks':len(blocks),'matched_traces':len(res),'counts':counts,'candidates':res},f,ensure_ascii=False,indent=2)
print(json.dumps({'trace_blocks':len(blocks),'matched_traces':len(res),'counts':counts},ensure_ascii=True))
