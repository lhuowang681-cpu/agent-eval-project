import copy,importlib.util,json,sys,unittest,threading
from pathlib import Path
from http.server import BaseHTTPRequestHandler,HTTPServer
from unittest.mock import patch
BASE=Path(__file__).resolve().parent
sys.path[:0]=[str(BASE/'shadow'),str(BASE/'data')]
from semantic_review import review
from client import prepare,generate
from build import make
class Tests(unittest.TestCase):
 def test_three_types(self):
  for kind in ['A','B','C','multi']:
   row=make('test',kind);r=review(row['trajectory'],row['fixtureCandidate']);self.assertEqual({x['category'] for x in r['supportedObservations']},set(row['labels']['expectedCategories']))
 def test_negative_and_recovered(self):
  for kind in ['normal','recovered','injection','explicit']:
   row=make('test',kind);self.assertEqual(review(row['trajectory'],row['fixtureCandidate'])['supportedObservations'],[])
 def test_invalid_candidates(self):
  for kind in ['fake','scope','wrong','root','missing']:
   row=make('test',kind);self.assertEqual(review(row['trajectory'],row['fixtureCandidate'])['supportedObservations'],[])
 def test_partial_coverage_and_no_mutation(self):
  row=make('test','B');before=copy.deepcopy(row);r=review(row['trajectory'],row['fixtureCandidate']);self.assertEqual(r['decision'],'supported');self.assertEqual(row,before);self.assertFalse(r['coverage']['complete'])
 def test_short_excerpt_same_field_context(self):
  row=make('test','B');row['fixtureCandidate']['observations'][0]['evidenceRefs'][0]['quote']='pending';self.assertEqual(review(row['trajectory'],row['fixtureCandidate'])['decision'],'supported')
 def test_unknown_source(self):
  row=make('test','B');row['trajectory']['nodes'][2]['toolSource']='unknown';self.assertFalse(review(row['trajectory'],row['fixtureCandidate'])['supportedObservations'])
 def test_cross_entity(self):
  row=make('test','B');row['trajectory']['nodes'][-1]['content']=json.dumps({'orderId':'other','status':'shipped'});row['fixtureCandidate']['observations'][0]['evidenceRefs'][-1]['quote']=row['trajectory']['nodes'][-1]['content'];r=review(row['trajectory'],row['fixtureCandidate']);self.assertEqual(r['reviews'][0]['existence'],'valid');self.assertFalse(r['supportedObservations'])
 def test_scalar_false_not_zero(self):
  row=make('test','A');row['fixtureCandidate']['observations'][0]['comparison']['actual']=False;self.assertFalse(review(row['trajectory'],row['fixtureCandidate'])['supportedObservations'])
 def test_context_and_privacy_gate(self):
  row=make('test','A')
  with self.assertRaises(ValueError):prepare(row['trajectory'],'production')
  row['trajectory']['evaluation']['task']='x'*12000
  with self.assertRaises(ValueError):prepare(row['trajectory'],'synthetic')
 def test_free_text_not_proven(self):
  row=make('test','B');row['trajectory']['nodes'][-1]['content']='The order shipped.';row['fixtureCandidate']['observations'][0]['evidenceRefs'][-1]['quote']='The order shipped.';r=review(row['trajectory'],row['fixtureCandidate']);self.assertEqual(r['reviews'][0]['existence'],'valid');self.assertFalse(r['supportedObservations'])
 def test_impact_and_prose_untrusted(self):
  row=make('test','A');row['fixtureCandidate']['observations'][0]['summary']='Definitely internal module bug';r=review(row['trajectory'],row['fixtureCandidate']);self.assertNotIn('Definitely',r['supportedObservations'][0]['summary']);row['fixtureCandidate']['observations'][0]['claimLevel']='impact_hypothesis';self.assertFalse(review(row['trajectory'],row['fixtureCandidate'])['supportedObservations'])
 def test_identity_order_and_malformed(self):
  for mutation in ['duplicate','order','scope','malformed','unknown']:
   row=make('test','B')
   if mutation=='duplicate':row['trajectory']['nodes'].append(copy.deepcopy(row['trajectory']['nodes'][0]))
   if mutation=='order':row['trajectory']['nodes'][1]['sequence']=0
   if mutation=='scope':row['trajectory']['nodes'][1]['scope']={'caseId':'elsewhere'}
   if mutation=='malformed':row['fixtureCandidate']['observations']=[None]
   if mutation=='unknown':row['fixtureCandidate'].update(decision='unknown',observations=[])
   self.assertFalse(review(row['trajectory'],row['fixtureCandidate'])['supportedObservations'])
 def test_transport_boundary_and_timeout(self):
  row=make('test','A')
  for endpoint in ['http://127.0.0.1:123@evil.example','https://other.example/chat/completions','http://127.0.0.1:12/?redirect=x']:
   with self.assertRaises(ValueError):generate(row['trajectory'],'synthetic','dummy',endpoint=endpoint)
  with patch('urllib.request.OpenerDirector.open',side_effect=TimeoutError):
   candidate,meta=generate(row['trajectory'],'synthetic','dummy');self.assertIsNone(candidate);self.assertEqual(meta['error'],'TimeoutError')
 def test_metric_truth_evidence_and_unknown_separate(self):
  import run_experiment as runner
  records=[];rows=[]
  for kind in ['A','fake','wrong','root','scope','missing']:
   row=make(kind,kind);rows.append(row);checked=review(row['trajectory'],row['fixtureCandidate'])
   records.append({'id':row['id'],'candidate':row['fixtureCandidate'],'rules':[],'direct':row['fixtureCandidate']['observations'],'reviewed':checked['supportedObservations']})
  metrics=runner.stats(records,rows)
  self.assertEqual(metrics['direct']['correctObservations'],3);self.assertEqual(metrics['direct']['wrongObservations'],1);self.assertEqual(metrics['direct']['unknownClaims'],2)
  self.assertEqual(metrics['direct']['coveredSemanticCases'],1);self.assertEqual(metrics['reviewed']['falseSupport'],0);self.assertEqual(metrics['reviewed']['falseGap'],0)
 def test_real_http_mock_errors(self):
  class Handler(BaseHTTPRequestHandler):
   body=b''
   def log_message(self,*args):pass
   def do_POST(self):
    request=json.loads(self.rfile.read(int(self.headers['Content-Length'])));assert request['max_tokens']==800
    self.send_response(200);self.end_headers();self.wfile.write(self.body)
  server=HTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
  try:
   for body,error in [(b'{bad',True),(json.dumps({'choices':[{'message':{'content':' '}}]}).encode(),True),(json.dumps({'choices':[{'message':{'content':'{}'},'finish_reason':'length'}]}).encode(),True),(json.dumps({'choices':[{'message':{'content':'{}'},'finish_reason':'stop'}],'usage':{'prompt_tokens':1}}).encode(),False)]:
    Handler.body=body;candidate,meta=generate(make('test','A')['trajectory'],'synthetic','synthetic-test-key',endpoint='http://127.0.0.1:'+str(server.server_port));self.assertEqual(bool(meta['error']),error)
  finally:server.shutdown();server.server_close();thread.join()
if __name__=='__main__':unittest.main(verbosity=2)
