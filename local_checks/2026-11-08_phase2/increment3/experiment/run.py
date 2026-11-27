"""Small controlled engineering comparison; no real-model credentials or external calls."""
import ast,copy,hashlib,json,os,pathlib,subprocess,sys,time,urllib.request
BASE=pathlib.Path(__file__).resolve().parent
PROJECT=BASE.parents[3]
PLATFORM=PROJECT/'local_checks/2026-11-08_platform_audit/platform'
PYTHON=pathlib.Path('C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe')
COMMANDS=[]
def run_json(script,value):
 command=[str(PYTHON),'-E','-s','-X','utf8',str(script)]
 started=time.perf_counter();result=subprocess.run(command,input=json.dumps(value,ensure_ascii=False),text=True,encoding='utf-8',capture_output=True,timeout=30,cwd=PLATFORM)
 COMMANDS.append({'command':command,'exitCode':result.returncode,'seconds':round(time.perf_counter()-started,3),'stderr':result.stderr})
 if result.returncode:raise RuntimeError('Controlled Python command failed: '+result.stderr+result.stdout)
 return json.loads(result.stdout)
def literal(path,name):
 tree=ast.parse(path.read_text(encoding='utf-8'))
 for node in tree.body:
  if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id==name for t in node.targets):return ast.literal_eval(node.value)
 raise ValueError(name)
def prepare():
 legacy=PROJECT/'source-reference/attribution'
 rows=literal(legacy/'taxonomy.py','ROWS')
 taxonomy='\n'.join(f"{key} {value[0]}｜问题：{'、'.join(value[1].split('|'))}｜信号：{'、'.join(value[2].split('|'))}" for key,value in rows.items())
 prompt=literal(legacy/'llm_classifier.py','SYSTEM_PROMPT').format(taxonomy=taxonomy)
 provenance={'method':'AST literal_eval only; did not import classifier/taxonomy or dotenv','classifierSha256':hashlib.sha256((legacy/'llm_classifier.py').read_bytes()).hexdigest(),'taxonomySha256':hashlib.sha256((legacy/'taxonomy.py').read_bytes()).hexdigest(),'promptSha256':hashlib.sha256(prompt.encode()).hexdigest(),'taxonomyModules':len(rows)}
 def trajectory(label,normal=False,unknown=False,partial=False):
  def node(identifier,role,seq,**extra):return dict(id=identifier,messageId=identifier,parentId=None,role=role,content='',sourcePointer='synthetic/'+identifier,errorSourcePointer=None,toolCallId=None,toolSource='unknown',toolName=None,arguments=None,error=None,traceId='trace-'+label,sequence=seq,createdAt=None,**extra)
  user=node(label+'-user','user',0);user['content']='Check order A1'
  assistant=node(label+'-assistant','assistant',1);assistant.update(parentId=user['id'],content='Normal response' if normal else '')
  nodes=[user,assistant]
  if not normal:
   call=node(label+'-call','call',2);call.update(parentId=assistant['id'],toolCallId='tool-call',toolSource='unknown' if unknown else 'mcp',toolName='orders____read',arguments='{"orderId":"A1"}')
   tool=node(label+'-result','tool',3);tool.update(parentId='missing-parent' if partial else assistant['id'],toolCallId='tool-call',toolSource=call['toolSource'],toolName=call['toolName'],error={'message':'Upstream HTTP 500','status':500},errorSourcePointer='synthetic/error')
   nodes.extend([call,tool])
  value={'schemaVersion':1,'trajectoryId':'synthetic:'+label,'inputDigest':'pending','scope':{'runId':'synthetic-run','caseId':label,'topicId':'topic-'+label,'threadId':None,'operationId':'op-'+label,'traceIds':['trace-'+label]},'nodes':nodes,'coverage':{'source':'database_messages','complete':not partial,'warnings':['dangling_parent'] if partial else []},'evaluation':{'status':'failed','score':0,'task':'Check order A1','expected':'Order details','actual':'Normal response' if normal else None,'criteria':None}}
  value['inputDigest']=hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False,separators=(',',':')).encode()).hexdigest();return value
 specs=[('normal_unknown','normal'),('external500_wrong_L2_2','root'),('valid_quote_no_causal_chain','root2'),('fabricated_node','fake'),('cross_case_node','cross'),('no_failure_signal','no_signal'),('unknown_source','unknown'),('missing_parent','partial'),('invalid_category_module','invalid'),('extra_causal_summary','extra'),('valid_observation_template','valid'),('supported_paraphrase','paraphrase')]
 fixtures=[]
 for label,kind in specs:
  value=trajectory(label,normal=kind in {'normal','no_signal'},unknown=kind=='unknown',partial=kind=='partial')
  rules=run_json(BASE/'rules_raw_cli.py',value)
  candidate=copy.deepcopy(rules['diagnosis'])
  if kind not in {'normal','valid','partial','paraphrase'}:
   candidate={'status':'needs_review','category':'external_tool_failure','moduleId':None,'claimLevel':'observation','summary':rules['diagnosis']['summary'],'evidenceRefs':[],'reasonCodes':[]}
   tool=value['nodes'][-1]
   candidate['evidenceRefs']=[{'nodeId':tool['id'],'field':'error' if tool['error'] else 'content','quote':json.dumps(tool['error'],sort_keys=True,ensure_ascii=False) if tool['error'] else tool['content']}]
  if kind in {'root','root2'}:candidate.update(status='resolved',moduleId='L2.2' if kind=='root' else 'L6.1',claimLevel='root_cause',summary='The internal agent generated invalid tool arguments and caused the upstream 500')
  if kind=='fake':candidate['evidenceRefs'][0]['nodeId']='fabricated-node'
  if kind=='cross':candidate['evidenceRefs'][0]['nodeId']='external500_wrong_L2_2-result'
  if kind=='invalid':candidate.update(category='invented_category',moduleId='L99.1')
  if kind=='extra':candidate['summary']='Upstream HTTP 500 was caused by internally mutated arguments'
  if kind=='paraphrase':candidate['summary']='The external tool returned HTTP 500; the responsible internal module is not established.'
  # Human-authored fixture label, independent of the rule engine's answer.
  expected=None if kind in {'normal','no_signal','unknown'} else 'external_tool_failure'
  fixture={'id':label,'trajectory':value,'candidate':candidate,'rules':rules,'labels':{'synthetic':True,'expectedObservationCategory':expected,'causalOwnerKnown':False,'directSemanticallySupported':kind in {'valid','partial','paraphrase'},'expectedBoundary':kind,'coverageSyntheticComplete':not (kind=='partial')}}
  fixtures.append(fixture)
 (BASE/'input.json').write_text(json.dumps({'prompt':prompt,'promptProvenance':provenance,'fixtures':fixtures},ensure_ascii=False,indent=2),encoding='utf-8')
 (BASE/'prepare-commands.json').write_text(json.dumps(COMMANDS,indent=2),encoding='utf-8')
 print(json.dumps({'fixtures':len(fixtures),'modules':len(rows),'prepared':True}))
def compare():
 data=json.loads((BASE/'input.json').read_text(encoding='utf-8'))
 direct_path=BASE/('direct-final.json' if (BASE/'direct-final.json').exists() else 'direct.json')
 direct=json.loads(direct_path.read_text(encoding='utf-8'))
 outputs={row['id']:row for row in direct['results']}
 records=[]
 for f in data['fixtures']:
  candidate=outputs[f['id']]['output']
  review=run_json(PLATFORM/'scripts/eval-attribution/review_cli.py',{'trajectory':f['trajectory'],'candidate':candidate})
  rules_review=run_json(PLATFORM/'scripts/eval-attribution/review_cli.py',{'trajectory':f['trajectory'],'candidate':f['rules']['diagnosis']})
  records.append({**f,'direct':outputs[f['id']],'review':review,'rulesReview':rules_review})
 methods={name:{'cases':len(records),'observationClaims':0,'moduleClaims':0,'semanticallyUnsupportedClaims':0,'reviewDefinedUnsafeClaims':0,'invalidOrMissingEvidenceClaims':0,'supportedObservationCases':0} for name in ['rules','direct','reviewed']}
 eligible=sum(row['labels']['expectedObservationCategory'] is not None for row in records)
 for row in records:
  for name in methods:
   c=row['rules']['diagnosis'] if name=='rules' else row['direct']['output'] if name=='direct' else row['review']['safeCandidate']
   if not isinstance(c,dict):continue
   claim=c.get('category') is not None or c.get('moduleId') is not None or c.get('claimLevel')=='root_cause'
   module=c.get('moduleId') is not None or c.get('claimLevel')=='root_cause'
   semantic=(row['labels']['directSemanticallySupported'] if name=='direct' else True) and c.get('category')==row['labels']['expectedObservationCategory'] and not module
   review=row['rulesReview'] if name=='rules' else row['review']
   m=methods[name];m['observationClaims']+=int(claim);m['moduleClaims']+=int(module)
   m['semanticallyUnsupportedClaims']+=int(claim and not semantic)
   m['reviewDefinedUnsafeClaims']+=int(claim and (review['review']['existence']['status']!='valid' or review['review']['support']['status']!='supported')) if name!='reviewed' else 0
   invalid_contract=any(issue['code'] in {'invalid_category','invalid_module','invalid_candidate'} for part in review['review'].values() for issue in part['issues'])
   m['invalidOrMissingEvidenceClaims']+=int(claim and (review['review']['existence']['status']=='invalid' or invalid_contract)) if name!='reviewed' else 0
   m['supportedObservationCases']+=int(claim and semantic)
 for m in methods.values():
  m.update(moduleAbstentionRate=1-m['moduleClaims']/m['cases'],observationAbstentionRate=1-m['observationClaims']/m['cases'],unsupportedClaimRate=m['semanticallyUnsupportedClaims']/m['cases'],reviewDefinedUnsafeClaimRate=m['reviewDefinedUnsafeClaims']/m['cases'],invalidOrMissingEvidenceClaimRate=m['invalidOrMissingEvidenceClaims']/m['cases'],supportedObservationCoverage=m['supportedObservationCases']/eligible if eligible else None,eligibleObservationCases=eligible)
 limitations=[r['id'] for r in records if r['labels']['directSemanticallySupported'] and r['review']['safeCandidate'] is None]
 report={'conditions':direct['conditions'],'directArtifact':direct_path.name,'realModel':{'status':'blocked','reason':'No approved real provider/model/credentials in isolated environment; no paid request made'},'methods':methods,'conservativeRejectionsOfLabeledSupportedObservations':limitations,'records':records,'promptProvenance':data['promptProvenance']}
 (BASE/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 (BASE/'review-commands.json').write_text(json.dumps(COMMANDS,indent=2),encoding='utf-8')
 print(json.dumps({'methods':methods,'conservativeRejections':limitations},ensure_ascii=True))
if __name__=='__main__':
 {'prepare':prepare,'compare':compare}[sys.argv[1]]()
