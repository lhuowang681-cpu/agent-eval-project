"""Offline analysis of all six real development calls; never requests a model."""
import copy,csv,hashlib,json,statistics,sys
from collections import Counter
from pathlib import Path
B=Path(__file__).resolve().parent;V1=B.parent/'model-smoke-v1'
sys.path.insert(0,str(B/'frozen/rules'))
from frozen.reviewer.review import review
from frozen.reviewer.baseline import generate
import adapter
def sig(o):return json.dumps([o['category'],o.get('comparison')],sort_keys=True)
def main():
 manifests=[('v1',B/'archive_inputs/v1-real-smoke.json'),('v2',B/'results/real-smoke-v2.json'),('v3',B/'results/real-smoke-v3.json')]
 tokens=Counter();out=[];latencies=[]
 for version,path in manifests:
  data=json.loads(path.read_text(encoding='utf-8'))
  for r in data['records']:
   t=r['trace'];http=json.loads(r['audits'][0]['responseBody']);usage=http['usage'];tokens.update({k:v for k,v in usage.items() if isinstance(v,int)});raw= http['choices'][0]['message']['content'];candidate=json.loads(raw)
   reviewed=review(t,candidate);enhanced=generate(t);er=review(t,enhanced);rules=adapter.analyze(t)
   accepted={sig(o) for o in reviewed['supportedObservations']};baseline={sig(o) for o in er['supportedObservations']}
   elapsed=r.get('response',{}).get('latencyMs',r.get('elapsedMs'));latencies.append(elapsed)
   record={'version':version,'case':r['case'],'scope':t['scope'],'httpStatus':r['audits'][0]['status'],'providerContractValid':'response' in r,'originalModelOutput':raw,'candidate':candidate,'review':reviewed,'originalRuleObservations':rules['observations'],'enhancedRuleCandidate':enhanced,'enhancedRuleReview':er,'acceptedLLMOnly':sorted(accepted-baseline),'expectedSemanticAbstention':r.get('expectedSemanticAbstention',False),'rawSemanticAbstained':not candidate.get('observations'),'usage':usage,'latencyMs':elapsed}
   out.append(record)
 peak=(tokens['prompt_cache_hit_tokens']*.006+tokens['prompt_cache_miss_tokens']*.3+tokens['completion_tokens']*1.2)/1000000
 summary={'realRequests':len(out),'sharedLedger':json.loads((B/'archive_inputs/v1-paid-smoke-ledger.json').read_text(encoding='utf-8')),'versions':{v:{'calls':sum(r['version']==v for r in out),'contractValid':sum(r['providerContractValid'] for r in out if r['version']==v),'supportedObservations':sum(len(r['review']['supportedObservations']) for r in out if r['version']==v)} for v,_ in manifests},'totalUsage':dict(tokens),'estimatedUsdRange':[peak/2,peak],'actualBill':None,'averageRequestMs':statistics.mean(latencies),'maxRequestMs':max(latencies),'acceptedLLMOnlyTotal':sum(len(r['acceptedLLMOnly']) for r in out),'acceptedUnprovenRootClaims':sum(o.get('claimLevel')!='observation' for r in out for o in r['review']['supportedObservations']),'v3NormalRecoveryCases':sum(r['version']=='v3' and r['case'] in ('normal','recovered') for r in out),'v3NormalRecoveryRawFalsePositives':sum(bool(r['candidate']['observations']) for r in out if r['version']=='v3' and r['case'] in ('normal','recovered')),'formalHoldoutCalls':0,'smokeMissingCoverage':['stale positive not called','insufficient evidence not called','actual tool-error retry recovery not represented; recovery sample only newer status correction'],'promotion':'NO: development iterations, tiny sample, no demonstrated enhanced-rule-exclusive semantic value'}
 for f in ['FREEZE.json','FREEZE_V3.json']:
  freeze=json.loads((B/f).read_text(encoding='utf-8'));assert all(hashlib.sha256((B/p).read_bytes()).hexdigest()==h for p,h in freeze['files'].items())
 (B/'results/analysis.json').write_text(json.dumps({'summary':summary,'caseResults':out},ensure_ascii=False,indent=2),encoding='utf-8')
 rows=[{'version':r['version'],'case':r['case'],'contractValid':r['providerContractValid'],'rawClaims':len(r['candidate'].get('observations',[])),'supported':len(r['review']['supportedObservations']),'originalRules':len(r['originalRuleObservations']),'enhancedRulesSupported':len(r['enhancedRuleReview']['supportedObservations']),'LLMOnly':len(r['acceptedLLMOnly']),'latencyMs':r['latencyMs']} for r in out]
 with (B/'results/per-call.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=rows[0]);w.writeheader();w.writerows(rows)
 print(json.dumps(summary,indent=2))
if __name__=='__main__':main()
