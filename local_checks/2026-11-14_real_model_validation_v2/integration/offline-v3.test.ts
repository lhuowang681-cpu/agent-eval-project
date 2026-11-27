import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync,writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createProvider,PROMPT } from './provider-v3';
async function main(){
 const root=resolve(process.argv[2]);const trace=JSON.parse(readFileSync(resolve(root,'smoke/normal.json'),'utf8'));let mode='valid';let requests=0;
 const server=createServer(async(req,res)=>{let text='';for await(const c of req)text+=c;const p=JSON.parse(text);requests++;assert.equal(p.messages[0].content,PROMPT);assert.equal(p.max_tokens,800);assert.equal(p.thinking.type,'disabled');
  const content=mode==='v1_failure'?{schemaVersion:1,scope:trace.scope,inputDigest:trace.inputDigest,decision:'observed_fault',observations:[]}:{schemaVersion:1,scope:trace.scope,inputDigest:trace.inputDigest,decision:'abstain',observations:[]};
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'offline-fixture',choices:[{message:{role:'assistant',content:JSON.stringify(content)},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}));
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const cfg=(name:string)=>({enabled:true,mode:'offline' as const,provider:'openai',model:'offline-fixture',baseURL:`http://127.0.0.1:${(server.address() as any).port}`,apiKey:'fake-local-key',approvedRequests:1,maxTokens:800,timeoutMs:10000,responseFormat:'json_object' as const,thinking:'disabled' as const,ledger:resolve(root,'results/mock-'+name+'-'+Date.now()+'.json')});
 try{
  mode='v1_failure';await assert.rejects(createProvider(cfg('reject')).generate(trace,'synthetic'));
  mode='valid';const p=createProvider(cfg('valid'));const out=await p.generate(trace,'synthetic');assert.equal(out.candidate.observations.length,0);assert.deepEqual(out.candidate.scope,trace.scope);await assert.rejects(p.generate(trace,'synthetic'));assert.equal(requests,2);
  writeFileSync(resolve(root,'results/offline-tests-v3.json'),JSON.stringify({oldInvalidDecisionStillRejected:true,completeAbstentionAccepted:true,budgetExhaustionBlocked:true,promptAndTransportVerified:true,localRequests:2,paidRequests:0},null,2));console.log('4 checks passed, no paid calls');
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(()=>{console.error('offline test failed');process.exitCode=1;});
