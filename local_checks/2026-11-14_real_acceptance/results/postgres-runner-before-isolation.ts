import assert from 'node:assert/strict';
import { randomUUID,createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:http';
import { createProvider } from './provider';
import { getServerDB } from '../../2026-11-08_platform_audit/platform/packages/database/src/core/db-adaptor';
import * as S from '../../2026-11-08_platform_audit/platform/packages/database/src/schemas';
import { AgentEvalAttributionService } from '../../2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution';
import { runPython } from '../../2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/python';
import { AttributionError,evidenceText } from '../../2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/contracts';
import { agentEvalExternalRouter } from '../../2026-11-08_platform_audit/platform/src/server/routers/lambda/agentEvalExternal';
import { eq,and } from '../../2026-11-08_platform_audit/platform/node_modules/drizzle-orm';
const ROOT=resolve(process.argv[2]);const python=process.env.EVAL_ATTRIBUTION_PYTHON!;
function sidecar(input:any,slow=false,model:any=null):Promise<any>{return new Promise((res,rej)=>{
 const child=spawn(python,slow?['-c','import time; time.sleep(5)']:['-E','-s','-X','utf8',resolve(ROOT,'review_candidate.py')],{cwd:ROOT,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},windowsHide:true,stdio:['pipe','pipe','pipe']});
 let out='';const timer=setTimeout(()=>{child.kill();rej(new AttributionError('python_timeout','Controlled child deadline'));},slow?100:10000);
 child.on('error',e=>{clearTimeout(timer);rej(e);});child.stdout.on('data',c=>{out+=c;if(out.length>1048576){child.kill();rej(Error('output_limit'));}});child.on('close',code=>{clearTimeout(timer);if(code!==0)return rej(Error('sidecar_exit'));try{res(JSON.parse(out));}catch(e){rej(e);}});child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({trajectory:input,...(model?{semanticCandidate:model.candidate,providerMetadata:model}:{})}));
});}
async function main(){
 assert.equal(process.env.DATABASE_URL,'postgresql://postgres@127.0.0.1:15435/vnext_acceptance_20261114');
 const db=await getServerDB();const user='vnext-'+randomUUID();await db.insert(S.users).values({id:user});let modelMockRequests=0;
 const mock=createServer(async(req,res)=>{try{
  let body='';for await(const c of req)body+=c;const request=JSON.parse(body);assert.equal(request.max_tokens,800);modelMockRequests++;
  const t=JSON.parse(request.messages.at(-1).content);const tool=t.nodes.find((n:any)=>n.role==='tool');const answer=t.nodes.filter((n:any)=>n.role==='assistant').at(-1);
  const candidate={schemaVersion:1,scope:t.scope,inputDigest:t.inputDigest,decision:'candidates',observations:[{id:'m1',category:'answer_tool_mismatch',claimLevel:'observation',summary:'Fixture comparison, not real model reasoning.',comparison:{key:'status',expected:'pending',actual:'shipped'},evidenceRefs:[{nodeId:tool.id,field:'content',quote:tool.content},{nodeId:answer.id,field:'content',quote:answer.content}]}]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'pg-fixture',object:'chat.completion',model:'local-model',choices:[{index:0,message:{role:'assistant',content:JSON.stringify(candidate)},finish_reason:'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}));
 }catch{res.statusCode=500;res.end('{}');}});
 await new Promise<void>(r=>mock.listen(0,'127.0.0.1',r));const endpoint=`http://127.0.0.1:${(mock.address() as any).port}/v1`;
 const provider=createProvider({enabled:true,mode:'offline',provider:'openai',model:'local-model',baseURL:endpoint,apiKey:'local-fake-key',approvedRequests:1,maxTokens:800,timeoutMs:10000,ledger:resolve(ROOT,'results/pg-provider-ledger-'+user+'.json')});
 const caller=agentEvalExternalRouter.createCaller({userId:user,headers:new Headers(),userAgent:'isolated-pg-acceptance'} as any);
 const [benchmark]=await db.insert(S.agentEvalBenchmarks).values({identifier:user,name:'VNext isolated',rubrics:[],userId:user,isSystem:false}).returning();
 const cases=[];const receipts=[];const records=[];let shadowCalls=0;
 for(const name of ['normal_passed','recovered_passed','explicit_off','explicit_on','recovered_quality_failed','multi','missing_call','worker_failure','worker_timeout','semantic_on']){
  const passed=name.endsWith('_passed');const [dataset]=await db.insert(S.agentEvalDatasets).values({benchmarkId:benchmark.id,identifier:name+'-'+user,name,userId:user,evalMode:'contains'}).returning();
  const [tc]=await db.insert(S.agentEvalTestCases).values({userId:user,datasetId:dataset.id,content:{input:'Isolated '+name,expected:passed?'correct':'absent-reference'}}).returning();
  const [run]=await db.insert(S.agentEvalRuns).values({userId:user,datasetId:dataset.id,name,status:'completed',config:{k:2},metrics:{totalCases:1,passedCases:passed?1:0,failedCases:passed?0:1,averageScore:passed?1:0,passRate:passed?1:0}}).returning();
  const [topic]=await db.insert(S.topics).values({userId:user,title:name,mode:'test',trigger:'eval'}).returning();
  const [thread]=await db.insert(S.threads).values({userId:user,topicId:topic.id,type:'eval',title:name,metadata:{status:passed?'passed':'failed',passed,score:passed?1:0,operationId:name+'-operation',rubricScores:[{rubricId:'fixed-judge',score:passed?1:0}]}}).returning();
  await db.insert(S.agentEvalRunTopics).values({userId:user,runId:run.id,topicId:topic.id,testCaseId:tc.id,status:passed?'passed':'failed',passed,score:passed?1:0,evalResult:{rubricScores:[{rubricId:'fixed-judge',score:passed?1:0}]}});
  let parent:any=null;let time=Date.now();const message=async(role:string,content:string,extra:any={})=>{const [m]=await db.insert(S.messages).values({userId:user,topicId:topic.id,threadId:thread.id,role,content,parentId:parent,createdAt:new Date(time+=10),...extra}).returning();parent=m.id;return m;};
  await message('user',JSON.stringify({orderId:tc.id,year:2025}));
  if(name!=='normal_passed'){
   const attempts=name.includes('recovered')||name==='multi'?2:1;
   for(let i=0;i<attempts;i++){
    const callId='call-'+i;const args=JSON.stringify({orderId:tc.id,year:2025});
    if(name!=='missing_call')await message('assistant','Calling tool',{tools:[{id:callId,type:'mcp',identifier:'orders',apiName:'lookup',arguments:args}]});
    const failed=i===0&&name!=='semantic_on';const output=JSON.stringify(failed?{success:false,error:'service unavailable'}:{success:true,data:{orderId:tc.id,status:'pending'}});
    const result=await message('tool',output);
    await db.insert(S.messagePlugins).values({id:result.id,userId:user,identifier:'orders',apiName:'lookup',toolCallId:callId,arguments:args,error:failed?{message:'service unavailable'}:null});
   }
  }
  await message('assistant',JSON.stringify({orderId:tc.id,status:name==='semantic_on'?'shipped':'pending'}));
  cases.push({name,runId:run.id,caseId:tc.id,threadId:thread.id,passed});
 }
 const snapshot=async()=>JSON.stringify({runs:await db.select().from(S.agentEvalRuns).where(eq(S.agentEvalRuns.userId,user)),topics:await db.select().from(S.agentEvalRunTopics).where(eq(S.agentEvalRunTopics.userId,user)),threads:await db.select().from(S.threads).where(eq(S.threads.userId,user)),messages:await db.select().from(S.messages).where(eq(S.messages.userId,user)),plugins:await db.select().from(S.messagePlugins).where(eq(S.messagePlugins.userId,user))});
 const before=await snapshot();
 for(const c of cases){
  const first=await caller.diagnosisRequest({runId:c.runId});const second=await caller.diagnosisRequest({runId:c.runId});
  assert.deepEqual(first.map(r=>r.id),second.map(r=>r.id));assert.ok(second.every(r=>!r.created));
  if(c.passed){assert.equal(first.length,0);records.push({...c,skippedByExistingPolicy:true});continue;}
  assert.equal(first.length,1);const id=first[0].id;receipts.push(id);
  const enabled=c.name!=='explicit_off';
  const service=new AgentEvalAttributionService(db,user,{runner:async(input,options)=>{
   if(c.name==='worker_failure')return runPython(input,{...options,executable:resolve(ROOT,'missing-python.exe')});
   if(c.name==='worker_timeout'){await sidecar(input,true);throw Error('deadline expected');}
   const base=await runPython(input,options);
   if(enabled){shadowCalls++;const generated=c.name==='semantic_on'?await provider.generate(input,'synthetic'):null;const artifact=await sidecar(input,false,generated);assert.equal(artifact.inputDigest,input.inputDigest);assert.deepEqual(artifact.scope,input.scope);assert.equal(artifact.diagnosis.moduleId,null);assert.equal(artifact.diagnosis.rootCause,null);
    if(c.name==='semantic_on')assert.equal(artifact.semantic.review.decision,'supported');
    const raw=JSON.stringify([input.inputDigest,'sidecar-v2-fixture']);const hash=createHash('sha256').update(raw).digest('hex');const sid=`${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    await db.insert(S.asyncTasks).values({id:sid,type:'vnext-shadow-acceptance',userId:user,status:'success',metadata:{scope:input.scope,inputDigest:input.inputDigest,parentJob:id,artifact}}).onConflictDoNothing();
   }
   return base;
  }});
  const processed=await service.processJob(id);const job=await caller.diagnosisGet({id});const trace=await service.getTrace(id);
  assert.equal((await service.processJob(id)).claimed,false);assert.deepEqual(job.scope,trace.scope);assert.equal(trace.scope.threadId,c.threadId);
  if(c.name.startsWith('worker_'))assert.equal(job.status,'error');else{assert.equal(job.status,'success');assert.deepEqual(job.result,await runPython(trace));}
  const side=await db.select().from(S.asyncTasks).where(and(eq(S.asyncTasks.userId,user),eq(S.asyncTasks.type,'vnext-shadow-acceptance')));
  const artifact=(side.find(s=>(s.metadata as any).parentJob===id)?.metadata as any)?.artifact;
  if(c.name==='explicit_off')assert.equal(artifact,undefined);
  if(c.name==='explicit_on'){assert.ok(artifact.observations.length>0);assert.equal(trace.coverage.complete,false);}
  if(c.name==='missing_call')assert.equal(artifact.observations.length,0);
  if(artifact){const nodes=new Map(trace.nodes.map(n=>[n.id,n]));for(const o of artifact.observations)for(const ref of o.evidenceRefs){const n:any=nodes.get(ref.nodeId);assert.ok(n);assert.ok(evidenceText(n[ref.field]).includes(ref.quote));}}
  records.push({...c,job,trace,artifact,processed});
 }
 assert.equal(await snapshot(),before);
 const other=new AgentEvalAttributionService(db,'other-user');assert.equal(await other.getJob(receipts[0]),undefined);
 const anonymous=agentEvalExternalRouter.createCaller({headers:new Headers()} as any);await assert.rejects(anonymous.diagnosisGet({id:receipts[0]}));
 assert.equal(modelMockRequests,1);mock.closeAllConnections();mock.close();
 await writeFile(resolve(ROOT,'results/postgres-e2e.json'),JSON.stringify({database:'real PostgreSQL, synthetic seeded rows',transport:'real tRPC server-side caller, not HTTP or login UI',records,checks:{scoreJudgeRunMessagesUnchanged:true,shadowCalls,modelMockRequests,paidModelRequests:0,normalAndRecoveredPassedSkipped:true,duplicateJobsIdempotent:true,traceIdentity:true,unprovenRoots:0,accessIsolation:true},runtimeExecution:'Seeded persisted messages, not a new live Agent model execution'},null,2));
 console.log(JSON.stringify({status:'passed',cases:records.length,shadowCalls,modelMockRequests}));
}
main().then(()=>process.exit(0)).catch(async e=>{await writeFile(resolve(ROOT,'results/postgres-e2e-error.json'),JSON.stringify({errorType:e?.name,message:String(e?.message).slice(0,1500)},null,2));console.error(e);process.exit(1);});
