import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createProvider } from './provider-v3';
async function main(){
 const root=resolve(process.argv[2]);const v1=resolve(root,'../model-smoke-v1');
 const grant=JSON.parse(readFileSync(resolve(v1,'BUDGET_AUTHORIZATION.json'),'utf8'));
 if(!grant.approved||grant.approvedRequests!==6||grant.maxUsd!==0.05||grant.formalRequestsAuthorized!==0)throw Error('budget_scope');
 const frozen=JSON.parse(readFileSync(resolve(root,'FREEZE_V3.json'),'utf8'));
 for(const [p,h] of Object.entries(frozen.files))if(createHash('sha256').update(readFileSync(resolve(root,p))).digest('hex')!==h)throw Error('frozen_source_changed');
 const file=resolve(root,'results/real-smoke-v3.json');if(existsSync(file))throw Error('preserve_results');
 const ledger=resolve(v1,'results/paid-smoke-ledger.json');const initial=JSON.parse(readFileSync(ledger,'utf8'));if(initial.approved!==6||initial.attempts!==3)throw Error('unexpected_existing_budget');
 const key=process.env.VNEXT_DEEPSEEK_API_KEY;if(!key)throw Error('credential_missing');
 const cfg=JSON.parse(readFileSync(resolve(root,'CONFIG.json'),'utf8'));let audits:any[]=[];
 const provider=createProvider({...cfg,enabled:true,approvedRequests:6,apiKey:key,ledger,audit:e=>audits.push(e)});
 const records:any[]=[];const manifest=JSON.parse(readFileSync(resolve(root,'smoke/CASES_V3.json'),'utf8'));
 for(const item of manifest){
  const state=JSON.parse(readFileSync(ledger,'utf8'));if(state.attempts>=6||(state.attempts+1)*.00516>.05)break;
  const trace=JSON.parse(readFileSync(resolve(root,item.file),'utf8'));audits=[];const start=performance.now();let ok=false;
  try{const response=await provider.generate(trace,'synthetic');records.push({case:item.name,trace,response,audits,expectedSemanticAbstention:item.expectedSemanticAbstention});ok=true;}
  catch(e:any){records.push({case:item.name,trace,error:String(e?.message??'failed'),elapsedMs:performance.now()-start,audits});}
  writeFileSync(file,JSON.stringify({stage:'development_smoke_v3_NOT_holdout',firstV1RequestPreserved:true,formalCalls:0,records,ledger:JSON.parse(readFileSync(ledger,'utf8')),actualBill:null},null,2));
  if(!ok && !audits.some(a=>a.status===200))break; // collect independent cases after model contract errors; never retry
 }
 console.log(JSON.stringify({newRequests:records.length,totalRequests:JSON.parse(readFileSync(ledger,'utf8')).attempts,formalCalls:0}));
}
main().catch(()=>{console.error('v2 smoke blocked/failed; no credential emitted');process.exitCode=1;});
