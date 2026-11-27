import copy,json,sys,unittest
from pathlib import Path
BASE=Path(__file__).resolve().parent
sys.path.insert(0,str(BASE/'previous/data'))
from build import make
from candidate.review import review
from candidate.baseline import generate
from reproduce import probes

def constrained(allowed=(2025,),actual=2024):
 r=make('dev','A');nodes=r['trajectory']['nodes']
 nodes[0]['content']=json.dumps({'task':'User supplied closed query policy','parameterConstraints':{'year':{'allowed':list(allowed),'closed':True}}})
 nodes[1]['arguments']=json.dumps({'year':actual,'orderId':'dev-order'})
 o=r['fixtureCandidate']['observations'][0];o['comparison'].update(expected=allowed[0],actual=actual)
 for ref in o['evidenceRefs']:ref['quote']=next(n for n in nodes if n['id']==ref['nodeId'])[ref['field']]
 return r

class ReviewTests(unittest.TestCase):
 def accepted(self,r):return review(r['trajectory'],r['fixtureCandidate'])['supportedObservations']
 def test_disclosed_red_green(self):
  for r in probes():self.assertFalse(self.accepted(r))
 def test_closed_single_query(self):self.assertTrue(self.accepted(constrained()))
 def test_year_over_year_and_base_period(self):
  for allowed in [(2025,2024),(2025,2020),(2025,2024,2023)]:
   for value in allowed:self.assertFalse(self.accepted(constrained(allowed,value)))
   self.assertTrue(self.accepted(constrained(allowed,1999)))
 def test_unknown_intent_is_not_a_violation(self):
  for kind in ['missing','open','plain']:
   r=constrained();n=r['trajectory']['nodes'][0]
   n['content']=json.dumps({'year':2025} if kind=='plain' else {'parameterConstraints':{'year':{'allowed':[2025],'closed':False}}} if kind=='open' else {'task':'查询近年的数据'})
   r['fixtureCandidate']['observations'][0]['evidenceRefs'][0]['quote']=n['content'];self.assertFalse(self.accepted(r))
 def test_latest_turn_replaces_constraints(self):
  r=constrained();n=copy.deepcopy(r['trajectory']['nodes'][0]);n.update(id='revised',sequence=1);r['trajectory']['nodes'][1]['sequence']=2;r['trajectory']['nodes'][2]['sequence']=3
  n['content']=json.dumps({'parameterConstraints':{'year':{'allowed':[2024],'closed':True}}});r['trajectory']['nodes'].insert(1,n)
  self.assertFalse(self.accepted(r));self.assertFalse(generate(r['trajectory'])['observations'])
 def test_identical_duplicates_keep_both_citable_ids(self):
  for cite_duplicate in [False,True]:
   r=make('dup','B');n=copy.deepcopy(r['trajectory']['nodes'][2]);n.update(id='duplicate',sequence=3);r['trajectory']['nodes'].insert(3,n)
   if cite_duplicate:r['fixtureCandidate']['observations'][0]['evidenceRefs'][0]['nodeId']='duplicate'
   self.assertTrue(self.accepted(r))
 def test_failed_success_conflict_and_whitespace_duplicates(self):
  r=make('dup','B');n=copy.deepcopy(r['trajectory']['nodes'][2]);n.update(id='duplicate',sequence=3,content=json.dumps(json.loads(n['content']),indent=2));r['trajectory']['nodes'].insert(3,n);self.assertTrue(self.accepted(r))
  n['error']={'message':'timeout'};self.assertFalse(self.accepted(r))
 def test_ambiguous_calls_and_scope(self):
  r=make('amb','B');n=copy.deepcopy(r['trajectory']['nodes'][1]);n.update(id='call-replay',sequence=-1);r['trajectory']['nodes'].insert(0,n);self.assertFalse(self.accepted(r))
  r=make('scope','B');r['trajectory']['nodes'][2]['scope']={**r['trajectory']['scope'],'threadId':'foreign'};self.assertFalse(self.accepted(r))
 def test_distinct_reexecution_and_recovery(self):
  self.assertEqual(len(self.accepted(make('retry','C'))),2);self.assertFalse(self.accepted(make('recovered','recovered')))
 def test_duplicate_result_cannot_create_staleness(self):
  r=make('dup','B');r['fixtureCandidate']['observations'][0]['category']='stale_information_use';self.assertFalse(self.accepted(r))
 def test_metamorphic_rename_reorder_shift(self):
  r=constrained();t=r['trajectory'];before=copy.deepcopy(r)
  for n in t['nodes']:
   old=n['id'];n['id']='renamed-'+old;n['sequence']+=100
   for ref in r['fixtureCandidate']['observations'][0]['evidenceRefs']:
    if ref['nodeId']==old:ref['nodeId']=n['id']
  t['nodes'].reverse();self.assertTrue(self.accepted(r));self.assertEqual(review(before['trajectory'],before['fixtureCandidate'])['decision'],'supported')
 def test_rule_proposals_and_review_separate(self):
  for r in [constrained(),make('B','B'),make('C','C')]:
   c=generate(r['trajectory']);self.assertTrue(c['observations']);self.assertEqual(len(review(r['trajectory'],c)['supportedObservations']),len(c['observations']))
 def test_strict_types_and_unreferenced_policy(self):
  r=constrained((1,),True);self.assertTrue(self.accepted(r))
  r=constrained();r['fixtureCandidate']['observations'][0]['evidenceRefs'].pop(0);self.assertFalse(self.accepted(r))
 def test_no_inputs_mutated(self):
  r=constrained();before=copy.deepcopy(r);self.accepted(r);generate(r['trajectory']);self.assertEqual(r,before)
if __name__=='__main__':unittest.main(verbosity=2)
