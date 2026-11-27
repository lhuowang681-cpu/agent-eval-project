"""Development regressions derived from audited failures, not holdout examples."""
import copy,json,sys,unittest
from pathlib import Path
base=Path(__file__).resolve().parents[1]
engine=Path(sys.argv.pop(1)) if len(sys.argv)>1 and not sys.argv[1].startswith('-') else base.parent/'2026-11-08_platform_audit/platform/scripts/eval-attribution'
sys.path.insert(0,str(engine))
import adapter
from evidence_review import audited_candidate


def request(content=None,error=None,source='mcp',complete=True):
    nodes=[{'id':'tool','messageId':'message','parentId':None,'role':'tool','content':content or '', 'sourcePointer':'fixture/message.content','errorSourcePointer':'fixture/plugin.error','toolCallId':'call','toolSource':source,'toolName':'orders.read','arguments':None,'error':error,'traceId':None,'sequence':1,'createdAt':None}]
    return {'schemaVersion':1,'trajectoryId':'dev-fixture','inputDigest':'dev-digest','scope':{'runId':'run','caseId':'case','topicId':'topic','threadId':None,'operationId':None,'traceIds':[]},'nodes':nodes,'coverage':{'source':'database_messages','complete':complete,'warnings':[] if complete else ['operation_events_unavailable','provider_request_payload_unavailable']},'evaluation':{'status':'failed','score':0,'task':'read order','expected':'data','actual':None,'criteria':None}}


def raw(value):return adapter.analyze(value)['diagnosis']


class QualityPolicyTests(unittest.TestCase):
    def test_partial_global_coverage_can_support_a_local_failure_without_claiming_owner(self):
        value=request(error={'message':'Upstream HTTP 500'},complete=False);before=copy.deepcopy(value)
        result=audited_candidate(value,raw(value))
        self.assertIsNotNone(result['safeCandidate'])
        self.assertEqual(result['safeCandidate']['claimLevel'],'observation')
        self.assertIsNone(result['safeCandidate']['moduleId'])
        self.assertEqual(before,value)

    def test_partial_graph_never_establishes_internal_owner(self):
        value=request(error={'message':'Upstream HTTP 500'},complete=False)
        result=audited_candidate(value,{**raw(value),'claimLevel':'root_cause','moduleId':'L2.2','status':'resolved'})
        self.assertIsNone(result['safeCandidate'])
        self.assertIn('root_cause_chain_not_available',[x['code'] for x in result['review']['support']['issues']])

    def test_success_content_cannot_borrow_an_uncited_error(self):
        value=request(content='lookup succeeded',error={'message':'Upstream HTTP 500'})
        candidate={**raw(value),'evidenceRefs':[{'nodeId':'tool','field':'content','quote':'lookup succeeded'}]}
        result=audited_candidate(value,candidate)
        self.assertEqual(result['review']['existence']['status'],'valid')
        self.assertIsNone(result['safeCandidate'])

    def test_quote_must_expose_the_claimed_category_not_another_metadata_value(self):
        value=request(error={'message':'missing required field','requestLabel':'harmless'},source='builtin')
        candidate={**raw(value),'evidenceRefs':[{'nodeId':'tool','field':'error','quote':'harmless'}]}
        self.assertEqual(candidate['category'],'builtin_tool_contract_invalid')
        self.assertIsNone(audited_candidate(value,candidate)['safeCandidate'])

    def test_successful_execution_with_business_false_is_not_execution_failure(self):
        value=request(content=json.dumps({'success':True,'data':{'success':False,'message':'no records'}}))
        candidate=raw(value)
        self.assertEqual(candidate['category'],'external_tool_failure') # unchanged rule-baseline limitation
        self.assertIsNone(audited_candidate(value,candidate)['safeCandidate'])

    def test_nested_business_false_without_execution_status_is_insufficient(self):
        value=request(content=json.dumps({'data':{'success':False}}))
        self.assertIsNone(audited_candidate(value,raw(value))['safeCandidate'])

    def test_explicit_failure_content_still_supported_with_partial_global_coverage(self):
        value=request(content=json.dumps({'success':False,'message':'permission denied'}),complete=False)
        result=audited_candidate(value,raw(value))
        self.assertIsNotNone(result['safeCandidate'])
        self.assertEqual(result['safeCandidate']['category'],'external_permission')

    def test_factual_paraphrase_is_still_not_machine_verified(self):
        value=request(error={'message':'Upstream HTTP 500'})
        candidate={**raw(value),'summary':'The external tool returned HTTP 500; owner is unconfirmed.'}
        result=audited_candidate(value,candidate)
        self.assertIsNone(result['safeCandidate'])
        self.assertIn('unverified_freeform_summary',[x['code'] for x in result['review']['support']['issues']])


if __name__=='__main__':unittest.main(verbosity=2)
