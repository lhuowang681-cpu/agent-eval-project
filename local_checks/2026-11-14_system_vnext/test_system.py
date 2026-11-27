import copy,json,time,unittest
from test_review import make
from vnext.pipeline import diagnose
from vnext.provider import MockProvider,invoke
from vnext.grouping import analyze
def event(i,**kw):
 e=dict(eventId=str(i),runId='r'+str(i),caseId='c',threadId='t',toolCallId='call',traceId='trace'+str(i),signature='timeout',source='mcp',tool='a',operation='query',environment='local',errorContext='deadline',recovered=True,taskResult='passed',severity=1,evidenceQuality=1,text='query timeout recovered');e.update(kw);return e
class SystemTests(unittest.TestCase):
 def test_default_does_not_call_provider(self):
  r=make('normal','normal');p=MockProvider({});x=diagnose(r['trajectory'],provider=p);self.assertEqual(p.calls,0);self.assertEqual(x['semantic']['status'],'disabled')
 def test_semantic_and_rules_coexist_without_score_mutation(self):
  r=make('b','B');before=copy.deepcopy(r['trajectory']);p=MockProvider(r['fixtureCandidate'])
  x=diagnose(r['trajectory'],dict(enabled=True,origin='synthetic',model='mock',maxCalls=1,maxTokens=500),p)
  self.assertEqual(len(x['observations']),1);self.assertEqual(x['semantic']['modelCalls'],1);self.assertEqual(before,r['trajectory'])
 def test_provider_error_privacy_and_budget(self):
  t=make('b','B')['trajectory'];p=MockProvider({});cfg=dict(origin='production',model='mock',maxCalls=1,maxTokens=50)
  with self.assertRaises(ValueError):invoke(p,t,cfg)
  cfg['origin']='synthetic';cfg['maxCalls']=0
  with self.assertRaises(ValueError):invoke(p,t,cfg)
 def test_timeout_and_late_result(self):
  class Slow:
   def generate(self,*a):time.sleep(.05);return {}
  cfg=dict(origin='synthetic',model='mock',maxCalls=1,maxTokens=50,timeoutSeconds=.005)
  with self.assertRaises(TimeoutError):invoke(Slow(),make('b','B')['trajectory'],cfg)
  self.assertEqual(cfg['maxCalls'],0)
 def test_recovered_and_normal_abstain_semantically(self):
  for kind in ['normal','recovered']:
   r=make('x',kind);x=diagnose(r['trajectory'],dict(enabled=True,origin='synthetic',model='mock',maxCalls=1,maxTokens=50),MockProvider(r['fixtureCandidate']));self.assertEqual(x['observations'],[])
 def test_severity_tail_not_typical_and_dedup(self):
  rows=[event(i) for i in range(99)]+[event(99,recovered=False,taskResult='failed',severity=5,evidenceQuality=3)]
  x=analyze(rows+[copy.deepcopy(rows[0])])[0]
  self.assertEqual((x['rawEvents'],x['uniqueEvents'],x['tasks']),(101,100,100));self.assertEqual((x['typicalSeverity'],x['maxSeverity']),(1,5));self.assertEqual(x['recoveryRate'],.99);self.assertEqual(x['taskFailureRate'],.01);self.assertIsNone(x['rootCause'])
 def test_same_symptom_different_tools_contexts(self):
  self.assertEqual(len(analyze([event(1),event(2,tool='b'),event(3,errorContext='connection')])),3)
 def test_ambiguous_outcomes_and_identity_conflict(self):
  a=event(1);b=event(2,runId=a['runId'],taskResult='failed');x=analyze([a,b])[0];self.assertEqual(x['unknownTaskOutcomes'],1);self.assertIsNone(x['taskFailureRate'])
  b=event(1,severity=5)
  with self.assertRaises(ValueError):analyze([a,b])
if __name__=='__main__':unittest.main(verbosity=2)
