import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createProvider } from './provider';
async function main(){
 const root=resolve(process.argv[2]);const fixture=JSON.parse(await readFile(resolve(root,'previous/results/demo-input.json'),'utf8'));let mode='good';let requests=0;const exchanges:any[]=[];const serverErrors:any[]=[];const runId=String(Date.now());
 const server=createServer(async(req,res)=>{
  try{
  let body='';for await(const c of req)body+=c;const input=JSON.parse(body);requests++;assert.equal(input.max_tokens,800);assert.ok(input.messages.every((m:any)=>!m.content.includes('scriptedCandidate')));
  let output:any=structuredClone(fixture.mockCandidate);
  if(mode==='root')output.observations[0].claimLevel='root_cause';
  if(mode==='identity')output.inputDigest='wrong';
  if(mode==='duplicate')output.observations.push(structuredClone(output.observations[0]));
  if(mode==='timeout')await new Promise(r=>setTimeout(r,350));
  const content=mode==='badjson'?'invalid json':mode==='empty'?' ':JSON.stringify(output);
  exchanges.push({mode,requestBody:input,responseContent:content});
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:'mock-fixture',object:'chat.completion',model:'local-configurable-model',choices:[{index:0,message:{role:'assistant',content},finish_reason:'stop'}],usage:{prompt_tokens:123,completion_tokens:45,total_tokens:168}}));
  }catch(e:any){if(e.code!=='ECONNRESET')serverErrors.push(e.name);if(!res.destroyed){res.statusCode=500;res.end();}}
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as any).port;const results=[];
 const config=(name:string)=>({enabled:true,mode:'offline' as const,provider:'openai',model:'local-configurable-model',baseURL:`http://127.0.0.1:${port}/v1`,apiKey:'local-fake-key',approvedRequests:1,maxTokens:800,timeoutMs:10000,ledger:resolve(root,'results/provider-ledger-'+runId+'-'+name+'.json')});
 try{
  let cfg=config('valid');let p=createProvider(cfg);const actual=await p.generate(fixture.trajectory,'synthetic');assert.deepEqual(actual.candidate,fixture.mockCandidate);assert.equal(actual.usage.total_tokens,168);results.push({test:'real_ModelRuntime_HTTP_mock_valid',passed:true,output:actual});
  const child=spawnSync(process.argv[3],['-E','-s','-X','utf8',resolve(root,'review_candidate.py')],{cwd:root,input:JSON.stringify({trajectory:fixture.trajectory,semanticCandidate:actual.candidate,providerMetadata:actual}),encoding:'utf8',windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot}});
  assert.equal(child.status,0,child.stderr);const reviewed=JSON.parse(child.stdout);assert.ok(reviewed.observations.length>0);assert.equal(reviewed.semantic.modelCallsInPython,0);assert.equal(reviewed.diagnosis.moduleId,null);results.push({test:'ModelRuntime_to_Python_review',passed:true});
  await writeFile(resolve(root,'results/provider-python-integration.json'),JSON.stringify(reviewed,null,2));
  const before=requests;await assert.rejects(p.generate(fixture.trajectory,'synthetic'));assert.equal(requests,before);results.push({test:'persistent_budget_exhaustion',passed:true});
  for(const bad of ['root','identity','duplicate','badjson','empty','timeout']){
   mode=bad;const cfg=config(bad);if(bad==='timeout')cfg.timeoutMs=100;
   await assert.rejects(createProvider(cfg).generate(fixture.trajectory,'synthetic'));results.push({test:bad,passed:true});
  }
  mode='good';const current=requests;
  await assert.rejects(createProvider({...config('disabled'),enabled:false}).generate(fixture.trajectory,'synthetic'));
  await assert.rejects(createProvider({...config('zero'),mode:'paid',baseURL:'https://example.invalid/v1',approvedRequests:0}).generate(fixture.trajectory,'synthetic'));
  await assert.rejects(createProvider(config('privacy')).generate(fixture.trajectory,'production'));
  assert.equal(requests,current);results.push({test:'disabled_zero_paid_budget_privacy_zero_network',passed:true});
  assert.equal(serverErrors.length,0);
  await writeFile(resolve(root,'results/provider-test.json'),JSON.stringify({tests:results.length,results,loopbackHttpRequests:requests,realPaidRequests:0,exchanges,usageWarning:'All usage values are synthetic Mock response values, not actual model token measurements.'},null,2));
  console.log(JSON.stringify({tests:results.length,passed:results.length,requests,paidRequests:0}));
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(e=>{console.error(String(e?.message??'provider_test_failure').slice(0,200));process.exitCode=1;});
