"""Review an externally generated ModelRuntime candidate; no model calls here."""
import json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'previous'))
from previous.vnext.pipeline import diagnose
from previous.baseline.candidate.review import review
if __name__=='__main__':
 try:
  raw=sys.stdin.buffer.read(1048577)
  if len(raw)>1048576:raise ValueError('input_limit')
  value=json.loads(raw.decode('utf-8'));t=value['trajectory'];result=diagnose(t)
  candidate=value.get('semanticCandidate');meta=value.get('providerMetadata',{})
  if candidate is not None:
   r=review(t,candidate);result['semantic']={'status':'completed','candidate':candidate,'review':r,'generation':'external_ModelRuntime','providerMetadata':{k:meta.get(k) for k in ['model','provider','promptVersion','latencyMs','usage','mode','actualCost']},'modelCallsInPython':0}
   result['observations'].extend(r['supportedObservations']);result['diagnosis']['status']='needs_review' if result['observations'] else 'unknown'
 except Exception as e:result={'error':type(e).__name__,'observations':[]}
 print(json.dumps(result,ensure_ascii=True));raise SystemExit(int('error' in result))
