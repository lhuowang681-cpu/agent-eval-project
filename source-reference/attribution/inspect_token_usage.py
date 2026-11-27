import re,json
import pandas as pd
p=r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx"
# Search structured-looking token/usage keys, not ordinary prose containing the word token.
pat=re.compile(r'"(?:usage|input_tokens|output_tokens|prompt_tokens|completion_tokens|total_tokens|cached_tokens|inputTokenCount|outputTokenCount|totalTokenCount|inputTokens|outputTokens|totalTokens)"\s*:',re.I)
result={}
for sheet,cols in [("RAW_NODES",["error","tools","metadata"]),("ERROR_EVENTS",["error_raw","metadata","tools"])]:
    d=pd.read_excel(p,sheet_name=sheet,usecols=lambda c:c in cols,dtype=str)
    result[sheet]={}
    for c in d.columns:
        vals=d[c].fillna("")
        matched=[v for v in vals if pat.search(v)]
        result[sheet][c]={"matches":len(matched),"samples":matched[:5]}
open("output/real_analysis/token_usage_scan.json","w",encoding="utf-8").write(json.dumps(result,ensure_ascii=False,indent=2))
print(json.dumps({s:{c:v['matches'] for c,v in cs.items()} for s,cs in result.items()},ensure_ascii=True))
