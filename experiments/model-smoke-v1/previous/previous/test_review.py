import copy,json,sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent/'baseline/previous/data'))
from build import make
from vnext.review import explicit_review
class EvidenceTests(unittest.TestCase):
 def row(self):
  r=make('dev','explicit');n=r['trajectory']['nodes'][2];return r['trajectory'],{'nodeId':n['id'],'field':'content','quote':'service unavailable'}
 def test_partial_trace_local_supported(self):
  t,ref=self.row();r=explicit_review(t,[ref]);self.assertEqual(r['localSupport'],'supported');self.assertFalse(r['global']['complete']);self.assertEqual(r['causalSupport'],'insufficient')
 def test_no_borrowed_error(self):
  t,ref=self.row();t['nodes'][2]['content']=json.dumps({'success':True,'note':'service unavailable'});self.assertEqual(explicit_review(t,[ref])['localSupport'],'insufficient')
 def test_nested_history_not_current_failure(self):
  t,ref=self.row();n=t['nodes'][2];n['error']=None;n['content']=json.dumps({'success':True,'history':{'success':False,'message':'service unavailable'}});self.assertEqual(explicit_review(t,[ref])['localSupport'],'insufficient')
 def test_root_not_upgraded(self):
  t,ref=self.row();self.assertEqual(explicit_review(t,[ref],claim='root_cause')['decision'],'needs_review')
 def test_bad_quote_and_scope(self):
  t,ref=self.row();ref['quote']='missing';self.assertEqual(explicit_review(t,[ref])['existence'],'invalid')
  t,ref=self.row();t['nodes'][2]['scope']={'caseId':'foreign'};self.assertEqual(explicit_review(t,[ref])['source'],'insufficient')
 def test_empty_and_mutation(self):
  t,ref=self.row();before=copy.deepcopy(t);explicit_review(t,[ref]);self.assertEqual(t,before);self.assertEqual(explicit_review(t,[])['localSupport'],'insufficient')
if __name__=='__main__':unittest.main(verbosity=2)
