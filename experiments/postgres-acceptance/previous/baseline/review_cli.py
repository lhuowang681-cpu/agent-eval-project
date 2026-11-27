"""Offline stdin {trajectory,candidate}; no network or platform imports."""
import json,sys
from candidate.review import review
if __name__=='__main__':
 try:
  raw=sys.stdin.buffer.read(1048577)
  if len(raw)>1048576:raise ValueError('input_limit')
  value=json.loads(raw.decode('utf-8-sig'),parse_constant=lambda _:(_ for _ in ()).throw(ValueError('nonfinite')))
  if not isinstance(value,dict) or not isinstance(value.get('trajectory'),dict):raise ValueError('envelope')
  result=review(value['trajectory'],value.get('candidate',value.get('scriptedCandidate')))
 except (ValueError,TypeError,KeyError):result={'decision':'needs_review','error':'invalid_input','supportedObservations':[]}
 print(json.dumps(result,ensure_ascii=True));raise SystemExit(int('error' in result))
