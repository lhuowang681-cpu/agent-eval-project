import copy,json,unittest
from quality import key,refs_valid,gold_key
class QualityTests(unittest.TestCase):
 def row(self):
  return {'scenario':'explicit','trajectory':{'nodes':[{'id':'tool','role':'tool','content':'{"success": false}', 'error':{'message':'failure'}}]}}
 def test_canonical_object_reference(self):
  r=self.row();self.assertEqual(refs_valid(r,{'evidenceRefs':[{'nodeId':'tool','field':'error','quote':'{"message": "failure"}'}]}),(1,1))
 def test_fake_reference_not_valid(self):
  self.assertEqual(refs_valid(self.row(),{'evidenceRefs':[{'nodeId':'other','field':'content','quote':'failure'}]}),(0,1))
 def test_explicit_category_granularity(self):
  o={'category':'external_transport','evidenceRefs':[{'nodeId':'tool','field':'error'}]};g={'kind':'execution_failure','evidenceScope':[('tool','content')]}
  self.assertEqual(key(self.row(),o),gold_key(g))
 def test_semantic_type_strict(self):
  o={'category':'answer_tool_mismatch','comparison':{'key':'state','expected':1,'actual':True}}
  g={'kind':'answer_tool_mismatch','key':'state','expected':True,'actual':True}
  self.assertNotEqual(key(self.row(),o),gold_key(g))
if __name__=='__main__':unittest.main(verbosity=2)
