import copy,json,unittest
from test_round2 import constrained
from evaluate import metrics
from candidate.mock import run
class MetricTests(unittest.TestCase):
 def fixture(self):
  r=constrained();o=r['fixtureCandidate']['observations'][0]
  return {'trajectory':r['trajectory'],'family':'A','variant':None,'explicitFailure':False,'gold':[{**copy.deepcopy(o),'truth':'correct','supportable':True,'requiredRefs':[(v['nodeId'],v['field']) for v in o['evidenceRefs']]}]},r['fixtureCandidate']
 def test_zero_accept_is_na_and_not_correct(self):
  row,c=self.fixture();empty={**c,'observations':[]};m=metrics([row],[{'raw':c,'out':empty}],'out','raw')
  self.assertIsNone(m['conclusionAccuracy']);self.assertEqual(m['falseGap'],1);self.assertEqual(m['coveredCases'],0)
 def test_citation_existence_not_truth(self):
  row,c=self.fixture();row['gold'][0]['truth']='incorrect';m=metrics([row],[{'raw':c,'out':c}],'out','raw')
  self.assertEqual(m['citationValidity'],1);self.assertEqual(m['falseSupport'],1);self.assertEqual(m['correct'],0)
 def test_root_unknown_not_success(self):
  row,c=self.fixture();row['gold'][0]['claimLevel']='root_cause';row['gold'][0]['truth']='unknown';c['observations'][0]['claimLevel']='root_cause'
  m=metrics([row],[{'out':c}],'out');self.assertEqual(m['unknown'],1);self.assertEqual(m['correct'],0)
 def test_mock_invalid_and_nonfinite(self):
  row,c=self.fixture()
  for raw in ['','bad','[]','{"x":NaN}']:self.assertIsNotNone(run(row['trajectory'],raw)['error'])
  self.assertEqual(run(row['trajectory'],json.dumps(c))['realCalls'],0)
if __name__=='__main__':unittest.main(verbosity=2)
