"""Sidecar on actual platform Trajectory v1. Never replaces Diagnostic v1."""
import copy,json,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'baseline/previous/baseline'))
import adapter
from baseline.candidate.review import review as semantic_review
from .review import explicit_review
from .provider import invoke
def diagnose(t,config=None,provider=None):
 adapter.validate(t);config=copy.deepcopy(config or {});before=copy.deepcopy(t)
 rules=adapter.analyze(t);reviews=[];observations=[]
 for obs in rules['observations']:
  r=explicit_review(t,obs['evidenceRefs']);reviews.append(r);observations.extend(r['observations'])
 semantic={'status':'disabled','candidate':None,'review':None,'modelCalls':0,'error':None}
 if config.get('enabled'):
  try:
   if provider is None:raise ValueError('provider_required_no_default')
   budget=config.get('maxCalls',0)
   try:candidate=invoke(provider,t,config)
   finally:semantic['modelCalls']=budget-config.get('maxCalls',0)
   semantic.update(status='completed',candidate=candidate,review=semantic_review(t,candidate))
   observations.extend(semantic['review']['supportedObservations'])
  except Exception as e:semantic.update(status='error',error=type(e).__name__)
 dedup={}
 for o in observations:
  comparison=o.get('comparison',{})
  k=json.dumps([o['category'],o.get('nodeId'),comparison.get('key'),comparison.get('actual'),sorted({r['nodeId'] for r in o['evidenceRefs']})],sort_keys=True);dedup.setdefault(k,o)
 assert t==before
 return {'schemaVersion':2,'scope':copy.deepcopy(t['scope']),'inputDigest':t['inputDigest'],'rulesBaseline':rules,'evidenceReviews':reviews,'semantic':semantic,'observations':list(dedup.values()),'diagnosis':{'status':'needs_review' if dedup else 'unknown','claimLevel':'observation','moduleId':None,'rootCause':None},'persistence':'sidecar_only_no_score_write'}
