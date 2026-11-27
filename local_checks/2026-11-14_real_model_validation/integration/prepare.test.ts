import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createProvider,PROMPT } from './provider';
import { PROMPT as originalPrompt } from '../../2026-11-14_real_acceptance/integration/provider';
async function main(){
 const root=resolve(process.argv[2]);assert.equal(PROMPT,originalPrompt);
 const trace=JSON.parse(readFileSync(resolve(root,'smoke/normal.json'),'utf8'));let requests=0;
 const server=createServer(async(req,res)=>{let body='';for await(const c of req)body+=c;const p=JSON.parse(body);requests++;assert.deepEqual(p.response_format,{type:'json_object'});assert.deepEqual(p.thinking,{type:'disabled'});assert.equal(p.max_tokens,800);assert.equal(p.messages[0].content,PROMPT);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({model:'local-fixture-returned-model',choices:[{message:{role:'assistant',content:JSON.stringify({schemaVersion:1,scope:trace.scope,inputDigest:trace.inputDigest,decision:'abstain',observations:[]})},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1}}));});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 try{
  const provider=createProvider({enabled:true,mode:'offline',provider:'openai',model:'local-fixture',baseURL:`http://127.0.0.1:${(server.address() as any).port}`,apiKey:'local-fake-key',approvedRequests:1,maxTokens:800,timeoutMs:10000,ledger:resolve(root,'results/local-prepare-'+Date.now()+'.json'),responseFormat:'json_object',thinking:'disabled'});
  const output=await provider.generate(trace,'synthetic');assert.equal(output.returnedModel,'local-fixture-returned-model');assert.equal(output.finishReason,'stop');assert.equal(requests,1);
  const blocked=spawnSync(process.execPath,['--import','tsx',resolve(root,'integration/smoke.ts'),root],{cwd:process.cwd(),env:{...process.env,VNEXT_DEEPSEEK_API_KEY:undefined},encoding:'utf8',timeout:30000,windowsHide:true});
  assert.equal(blocked.status,1);assert.equal(existsSync(resolve(root,'results/paid-smoke-ledger.json')),false);
  writeFileSync(resolve(root,'results/preparation-tests.json'),JSON.stringify({promptIdentical:true,transportParametersVerified:true,modelMetadataCaptured:true,budgetNotApprovedBlocked:true,localMockRequests:requests,paidRequests:0},null,2));
  console.log(JSON.stringify({checks:4,localRequests:requests,paidRequests:0}));
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(()=>{console.error('preparation test failed');process.exitCode=1;});
