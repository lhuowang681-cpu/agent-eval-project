"""Independent local execution witness; no shared keyword classification."""
import json
from baseline.candidate.facts import obj,result_index
def wire(v):return v if isinstance(v,str) else json.dumps(v,ensure_ascii=False,sort_keys=True)
def explicit_review(t,refs,claim='observation'):
 r={'schemaVersion':2,'existence':'valid','source':'insufficient','localSupport':'insufficient','causalSupport':'insufficient','global':t['coverage'].copy(),'decision':'needs_review','observations':[],'issues':[]}
 try:
  if not isinstance(refs,list) or len(refs)>32:raise ValueError('invalid_references')
  nodes={n['id']:n for n in t['nodes']};index=result_index(t)
  if len(nodes)!=len(t['nodes']):raise ValueError('duplicate_node')
  for ref in refs:
   n=nodes.get(ref.get('nodeId'));field=ref.get('field');quote=ref.get('quote')
   if not n or field not in ('content','error','arguments') or not isinstance(quote,str) or not quote or quote not in wire(n[field]):raise ValueError('invalid_reference')
  if any(n.get('scope',t['scope'])!=t['scope'] for n in t['nodes']):r['issues'].append('scope_mismatch');return r
  r['source']='known_with_partial_trace'
  for ref in refs:
   n=nodes[ref['nodeId']];field=ref['field'];body=obj(n['content'])
   if n['role']!='tool' or index[n['id']]['issue']:continue
   failed=(body.get('success') is False or body.get('ok') is False) if field=='content' else bool(n.get('error')) and isinstance(n['error'],dict) and not (body.get('success') is True or body.get('ok') is True) if field=='error' else False
   if failed:r['observations'].append({'category':'observed_execution_failure','claimLevel':'observation','nodeId':n['id'],'evidenceRefs':[ref.copy()],'summary':'Original cited field records an execution failure; causal owner unknown.'})
  if r['observations']:r['localSupport']='supported'
  if claim!='observation':r['issues'].append('causal_chain_unavailable');return r
  r['decision']='supported' if r['observations'] else 'needs_review'
 except (KeyError,TypeError,ValueError):r.update(existence='invalid');r['issues'].append('invalid_reference_or_source')
 return r
