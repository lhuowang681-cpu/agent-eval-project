import copy
import hashlib
import json
import unittest
import validate_holdout as validator

class IndependentValidationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.cases=validator.load(validator.HOME/'private'/'cases.jsonl')
        cls.inputs=validator.load(validator.HOME/'inputs.jsonl')

    def projection(self, cases):
        return [{k:v for k,v in case.items() if k!='labels'} for case in cases]

    def test_all_authored_records(self):
        self.assertEqual(validator.validate_data(self.cases,self.inputs),28)

    def test_public_projection_rejects_label_insertion(self):
        public=copy.deepcopy(self.inputs);public[0]['labels']={'candidateCorrect':True}
        with self.assertRaisesRegex(ValueError,'public case keys'):
            validator.validate_data(self.cases,public)

    def test_modified_trace_requires_new_digest(self):
        cases=copy.deepcopy(self.cases);cases[0]['trajectory']['nodes'][0]['content']+=' changed'
        with self.assertRaisesRegex(ValueError,'digest mismatch'):
            validator.validate_data(cases,self.projection(cases))

    def test_rehashed_module_label_in_trace_is_still_detected(self):
        cases=copy.deepcopy(self.cases);t=cases[0]['trajectory'];t['nodes'][0]['content']+=' expected module L5.3'
        t['inputDigest']=hashlib.sha256(validator.canonical({k:v for k,v in t.items() if k!='inputDigest'}).encode()).hexdigest()
        with self.assertRaisesRegex(ValueError,'module target literal leaked'):
            validator.validate_data(cases,self.projection(cases))

    def test_false_unknown_root_with_positive_target_is_rejected(self):
        cases=copy.deepcopy(self.cases);r=cases[0]['labels']['root'];r.update(known=False,moduleId='L1.1')
        with self.assertRaisesRegex(ValueError,'unknown root cannot have a target'):
            validator.validate_data(cases,self.projection(cases))

    def test_abstention_is_not_relabelled_as_positive_correctness(self):
        cases=copy.deepcopy(self.cases)
        case=next(c for c in cases if c['candidate']['status']=='unknown')
        case['labels']['candidateCorrect']=True
        with self.assertRaisesRegex(ValueError,'abstention must not count'):
            validator.validate_data(cases,self.projection(cases))

    def test_root_true_target_consistency(self):
        cases=copy.deepcopy(self.cases)
        case=next(c for c in cases if c['candidate']['claimLevel']=='root_cause' and c['labels']['candidateCorrect'] is True)
        case['labels']['root']['moduleId']='L1.1'
        with self.assertRaisesRegex(ValueError,'true root candidate target mismatch'):
            validator.validate_data(cases,self.projection(cases))

    def test_bad_candidate_references_remain_untouched_as_test_inputs(self):
        before=json.dumps(self.cases,sort_keys=True,ensure_ascii=False)
        validator.validate_data(self.cases,self.inputs)
        self.assertEqual(json.dumps(self.cases,sort_keys=True,ensure_ascii=False),before)

if __name__=='__main__':unittest.main()
