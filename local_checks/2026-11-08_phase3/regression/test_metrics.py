from pathlib import Path
import copy,sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'experiment'))
from metrics import summarize,valid_references


def data():
    row={'id':'one','trajectory':{'nodes':[{'id':'n','content':'failure','error':None,'arguments':None}]},'candidate':{'status':'unknown','category':None,'moduleId':None,'claimLevel':'observation','summary':'unknown','evidenceRefs':[]},'labels':{'observationEligible':True,'observationCategories':['external_tool_failure'],'root':{'known':True,'category':'external_tool_failure','moduleId':'L2.2'},'candidateCorrect':None,'candidateSupported':False,'safeCanonicalSupported':False,'ruleCanonicalSupported':True}}
    outcome={'output':row['candidate'],'executionError':None,'localSeconds':0}
    result={'records':[{'id':'one','outcomes':{name:copy.deepcopy(outcome) for name in ['rules','direct','structured','citations','full']}}]}
    return row,result


class MetricsTests(unittest.TestCase):
    def test_abstention_is_not_correct_known_root_or_perfect_precision(self):
        row,result=data();m=summarize([row],result)['metrics']['full']
        self.assertEqual(m['rootClassificationAccuracyAllKnown'],0)
        self.assertIsNone(m['acceptedAccuracy'])
        self.assertEqual(m['effectiveObservationCoverage'],0)
        self.assertEqual(m['abstentionRate'],1)

    def test_unknown_truth_is_not_automatically_a_wrong_attribution(self):
        row,result=data();row['labels']['root']['known']=False
        value={**row['candidate'],'category':'external_tool_failure','moduleId':'L2.2','claimLevel':'root_cause'}
        result['records'][0]['outcomes']['direct']['output']=value
        m=summarize([row],result)['metrics']['direct']
        self.assertEqual(m['unjudgedClaims'],1);self.assertEqual(m['wrongClaims'],0)
        self.assertEqual(m['unsupportedClaims'],1);self.assertIsNone(m['acceptedAccuracy'])
        self.assertEqual(m['allClaimErrorRiskBounds'],[0,1])

    def test_reference_presence_does_not_prove_support_or_correctness(self):
        row,result=data();row['labels'].update(candidateCorrect=False,candidateSupported=False)
        value={**row['candidate'],'category':'external_permission','evidenceRefs':[{'nodeId':'n','field':'content','quote':'failure'}]}
        result['records'][0]['outcomes']['direct']['output']=value
        m=summarize([row],result)['metrics']['direct']
        self.assertEqual(m['evidenceReferenceValidity'],1)
        self.assertEqual(m['acceptedAccuracy'],0);self.assertEqual(m['acceptedSupportPrecision'],0)

    def test_bad_reference_types_do_not_crash_statistics(self):
        row,_=data()
        self.assertEqual(valid_references(row['trajectory'],{'evidenceRefs':[{'nodeId':'n','field':[],'quote':'failure'}]})['valid'],0)
        self.assertEqual(valid_references(row['trajectory'],{'evidenceRefs':[{'nodeId':[],'field':'content','quote':'failure'}]})['valid'],0)

    def test_execution_error_is_separate_from_normal_abstention(self):
        row,result=data();result['records'][0]['outcomes']['full'].update(output=None,executionError='ValueError')
        m=summarize([row],result)['metrics']['full']
        self.assertEqual(m['executionErrors'],1);self.assertEqual(m['abstentions'],0)
        self.assertEqual(m['rootAbstentionRate'],0)
        self.assertEqual(m['rootNoClaimIncludingErrorRate'],1)

    def test_correct_root_is_scored_only_against_known_root_label(self):
        row,result=data();row['labels'].update(candidateCorrect=True,candidateSupported=True)
        value={**row['candidate'],'category':'external_tool_failure','moduleId':'L2.2','claimLevel':'root_cause','evidenceRefs':[{'nodeId':'n','field':'content','quote':'failure'}]}
        result['records'][0]['outcomes']['direct']['output']=value
        m=summarize([row],result)['metrics']['direct']
        self.assertEqual(m['rootClassificationAccuracyAllKnown'],1)
        self.assertEqual(m['effectiveObservationCases'],0)

    def test_duplicate_or_missing_results_cannot_inflate_coverage(self):
        row,result=data();result['records']*=2
        with self.assertRaises(ValueError):summarize([row],result)
        result['records']=[]
        with self.assertRaises(ValueError):summarize([row],result)

    def test_coverage_eligibility_cannot_replace_a_support_annotation(self):
        row,result=data();del row['labels']['ruleCanonicalSupported']
        with self.assertRaises(ValueError):summarize([row],result)


if __name__=='__main__':unittest.main(verbosity=2)
