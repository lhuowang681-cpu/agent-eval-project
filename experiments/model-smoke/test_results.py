import copy,json,unittest
from pathlib import Path
from frozen.reviewer.review import review
B=Path(__file__).resolve().parent
class ResultsTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):cls.data=json.loads((B/'results/analysis.json').read_text(encoding='utf-8'))
 def record(self,version,case):return next(r for r in self.data['caseResults'] if r['version']==version and r['case']==case)
 def test_missing_identity_still_rejected(self):self.assertEqual(self.record('v1','parameter_closed')['review']['supportedObservations'],[])
 def test_numeric_string_still_rejected(self):
  r=self.record('v2','parameter_closed');self.assertIsInstance(r['candidate']['observations'][0]['comparison']['actual'],str);self.assertEqual(r['review']['supportedObservations'],[])
 def test_invalid_enum_still_rejected(self):
  r=self.record('v2','answer_mismatch');self.assertEqual(r['candidate']['decision'],'observed_fault');self.assertFalse(r['providerContractValid']);self.assertEqual(r['review']['supportedObservations'],[])
 def test_answer_supported_with_original_evidence(self):
  r=self.record('v3','answer_mismatch');self.assertEqual(len(r['review']['supportedObservations']),1);self.assertEqual(r['acceptedLLMOnly'],[])
 def test_normal_recovered_abstain(self):
  for name in ['normal','recovered']:self.assertEqual(self.record('v3',name)['candidate']['observations'],[])
 def test_budget_and_cost_not_invoice(self):
  s=self.data['summary'];self.assertEqual(s['realRequests'],6);self.assertEqual(s['sharedLedger']['attempts'],6);self.assertLess(s['estimatedUsdRange'][1],.05);self.assertIsNone(s['actualBill']);self.assertEqual(s['formalHoldoutCalls'],0)
if __name__=='__main__':unittest.main(verbosity=2)
