"""Metrics against authored propositions, never reviewer self-ratings."""
import json
def signature(o):return json.dumps([o.get('category'),o.get('claimLevel'),o.get('comparison')],sort_keys=True,ensure_ascii=False)
def citation(t,c,o):
 nodes={n['id']:n for n in t['nodes']};refs=o.get('evidenceRefs',[]);valid=0;pairs=set()
 for r in refs:
  n=nodes.get(r.get('nodeId'));value=n.get(r.get('field')) if n else None
  value=value if isinstance(value,str) else json.dumps(value,ensure_ascii=False,sort_keys=True)
  ok=bool(n and isinstance(r.get('quote'),str) and r['quote'] and r['quote'] in value)
  valid+=ok
  if ok:pairs.add((r['nodeId'],r['field']))
 return valid,len(refs),pairs
def assess(row,c,o):
 t=row['trajectory'];valid,total,pairs=citation(t,c,o);g=next((g for g in row['gold'] if signature(g)==signature(o)),None)
 if o.get('category','').startswith('external_'):
  expected='external_timeout' if row['variant']=='failed_conflict' else 'external_transport' if row['explicitFailure'] else None
  truth='correct' if o['category']==expected else 'unknown';required=pairs;human=truth=='correct'
 else:
  truth=g['truth'] if g else 'unknown' if o.get('claimLevel')!='observation' else 'incorrect'
  required={tuple(v) for v in g['requiredRefs']} if g else set();human=g['supportable'] if g else False
 if row['variant'] in ('duplicate','whitespace'):
  def norm(pair):
   return ('duplicate-logical-result',pair[1]) if pair[0].endswith(('-r1','-rdup')) and pair[1]=='content' else pair
  pairs={norm(p) for p in pairs};required={norm(p) for p in required}
 identity=c.get('scope')==t['scope'] and c.get('inputDigest')==t['inputDigest']
 scope=all(n.get('scope',t['scope'])==t['scope'] for n in t['nodes'])
 adequate=truth=='correct' and human and valid==total and total>0 and required<=pairs and identity and scope
 return {'truth':truth,'adequate':adequate,'validReferences':valid,'references':total}
def metrics(rows,records,method,raw_method=None):
 count=correct=wrong=unknown=refs=valid=accepted_unsupported=gap=true_rejected=covered=detected=abstain=casecorrect=definite=0;bytype={}
 for row,record in zip(rows,records):
  c=record[method];obs=c.get('observations',[]);found=set();supported=set();bad=False
  positives={signature(g) for g in row['gold'] if g['truth']=='correct'}
  unknown_only=not positives and any(g['truth']=='unknown' for g in row['gold'])
  if not unknown_only:definite+=1
  if not obs:abstain+=1
  for o in obs:
   a=assess(row,c,o);count+=1;correct+=a['truth']=='correct';wrong+=a['truth']=='incorrect';unknown+=a['truth']=='unknown';valid+=a['validReferences'];refs+=a['references']
   if a['truth']=='correct':found.add(signature(o))
   else:bad=True
   if a['adequate']:supported.add(signature(o))
   else:accepted_unsupported+=1
  if positives and supported&positives:covered+=1
  detected+=len(supported&positives)
  if not unknown_only and positives<=found and not bad:casecorrect+=1
  if raw_method:
   raw=record[raw_method];adequate_raw={signature(o) for o in raw.get('observations',[]) if assess(row,raw,o)['adequate']}
   raw_true={signature(o) for o in raw.get('observations',[]) if assess(row,raw,o)['truth']=='correct'}
   gap+=len(adequate_raw-supported);true_rejected+=len(raw_true-found)
  group=bytype.setdefault(row['family'],{'cases':0,'positiveCases':0,'coveredCases':0,'claims':0})
  group['cases']+=1;group['positiveCases']+=bool(positives);group['coveredCases']+=bool(supported&positives);group['claims']+=len(obs)
 positive_cases=sum(any(g['truth']=='correct' for g in r['gold']) for r in rows)
 return {'cases':len(rows),'claims':count,'correct':correct,'incorrect':wrong,'unknown':unknown,'conclusionAccuracy':correct/count if count else None,'judgedAccuracy':correct/(correct+wrong) if correct+wrong else None,'caseCorrect':casecorrect,'definiteCases':definite,'caseAccuracy':casecorrect/definite if definite else None,'positiveCases':positive_cases,'coveredCases':covered,'effectiveCoverage':covered/positive_cases if positive_cases else None,'detectedObservations':detected,'falseSupport':accepted_unsupported if raw_method else None,'falseGap':gap if raw_method else None,'trueObservationRejects':true_rejected if raw_method else None,'references':refs,'validReferences':valid,'citationValidity':valid/refs if refs else None,'abstentions':abstain,'abstentionRate':abstain/len(rows),'byType':bytype}
