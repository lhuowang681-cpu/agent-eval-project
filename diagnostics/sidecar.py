import json,sys
from vnext.pipeline import diagnose
from vnext.provider import MockProvider
if __name__=='__main__':
 try:
  data=sys.stdin.buffer.read(1048577)
  if len(data)>1048576:raise ValueError('input_limit')
  value=json.loads(data.decode('utf-8'));t=value.get('trajectory',value);cfg=value.get('config',{})
  mock=MockProvider(value['mockCandidate']) if 'mockCandidate' in value else None
  result=diagnose(t,cfg,mock)
 except Exception as e:result={'error':type(e).__name__,'scope':None,'observations':[]}
 print(json.dumps(result,ensure_ascii=True));raise SystemExit(int('error' in result))
