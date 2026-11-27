import json
from pathlib import Path
import pandas as pd

src = Path(r"D:\Users\martinma\Desktop\TripYoYo_Error_Traces_20260720_20260727.xlsx")
out = Path("output/nested_error_details.json")
e = pd.read_excel(src, sheet_name="ERROR_EVENTS")
rows=[]
for _,r in e.iterrows():
    raw=r.get("error_raw")
    try: d=json.loads(raw) if isinstance(raw,str) and raw.strip() else {}
    except Exception: d={}
    body=d.get("body",{}) if isinstance(d,dict) else {}
    body=body if isinstance(body,dict) else {}
    err=body.get("error",{})
    err=err if isinstance(err,dict) else {}
    rows.append({
      "trace_id":str(r.get("effective_trace_id") or ""),
      "error_type":str(r.get("error_type") or ""),
      "error_message":"" if pd.isna(r.get("error_message")) else str(r.get("error_message")),
      "body_name":str(body.get("name", "")),
      "body_message":str(body.get("message", "")),
      "nested_name":str(err.get("name", "")),
      "nested_type":str(err.get("type", "")),
      "nested_status":str(err.get("status", "")),
      "nested_code":str(err.get("code", "")),
      "nested_message":str(err.get("message", "")),
      "endpoint":str(body.get("endpoint", "")),
      "provider":"" if pd.isna(r.get("provider")) else str(r.get("provider")),
      "model":"" if pd.isna(r.get("model")) else str(r.get("model")),
    })
df=pd.DataFrame(rows)
keys=["error_type","error_message","body_name","body_message","nested_name","nested_type","nested_status","nested_code","nested_message"]
g=(df.groupby(keys,dropna=False)
   .agg(events=("trace_id","size"),traces=("trace_id","nunique"),
        providers=("provider",lambda x:",".join(sorted(set(x)-{""}))),
        models=("model",lambda x:",".join(sorted(set(x)-{""}))))
   .reset_index().sort_values(["traces","events"],ascending=False))
out.parent.mkdir(exist_ok=True)
out.write_text(json.dumps(g.to_dict("records"),ensure_ascii=False,indent=2),encoding="utf-8")
print(f"events={len(e)} traces={e.effective_trace_id.nunique()} nested_signatures={len(g)} file={out}")
