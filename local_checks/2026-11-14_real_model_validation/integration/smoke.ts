/** Does not send any paid request without a separately recorded budget grant. */
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { createProvider } from './provider';
async function main(){
 const root=resolve(process.argv[2]);const grant=JSON.parse(readFileSync(resolve(root,'BUDGET_AUTHORIZATION.json'),'utf8'));
 if(grant.approved!==true||grant.approvedRequests!==6||grant.maxUsd!==0.05||grant.stage!=='smoke')throw Error('explicit_smoke_budget_required');
 const cfg=JSON.parse(readFileSync(resolve(root,'SMOKE_CONFIG.json'),'utf8'));
 const frozen=JSON.parse(readFileSync(resolve(root,'RUN_FREEZE.json'),'utf8'));
 for(const [file,hash] of Object.entries(frozen.files))if(createHash('sha256').update(readFileSync(resolve(root,file))).digest('hex')!==hash)throw Error('frozen_source_changed');
 const key=process.env.VNEXT_DEEPSEEK_API_KEY;if(!key)throw Error('credential_env_missing');
 const manifest=JSON.parse(readFileSync(resolve(root,'smoke/CASES.json'),'utf8'));
 const records:any[]=[];let audits:any[]=[];
 const provider=createProvider({...cfg,enabled:true,approvedRequests:6,apiKey:key,ledger:resolve(root,'results/paid-smoke-ledger.json'),audit:e=>audits.push(e)});
 const resultFile=resolve(root,'results/real-smoke.json');if(existsSync(resultFile))throw Error('preserve_existing_smoke_results');
 let costReserve=0;
 for(const item of manifest){
  // Reserve conservative peak/cache-miss maximum before each request.
  if(costReserve+0.00516>grant.maxUsd)break;costReserve+=0.00516;audits=[];
  const trace=JSON.parse(readFileSync(resolve(root,item.file),'utf8'));const started=Date.now();let success=false;
  try{const response=await provider.generate(trace,'synthetic');records.push({case:item.name,trace,source:'real_supplier_on_development_synthetic',response,audits,expectedSemanticAbstention:item.expectedSemanticAbstention});success=true;}
  catch(error:any){records.push({case:item.name,trace,error:String(error?.message??'failed'),audits,elapsedMs:Date.now()-started});}
  writeFileSync(resultFile,JSON.stringify({stage:'real_smoke_NOT_holdout',model:cfg.model,promptFrozen:true,reservedUsd:costReserve,actualBill:null,records,formalExperimentRun:false},null,2));
  if(!success)break; // no auto-retry, no model/prompt fallback after failure
 }
 console.log(JSON.stringify({smokeCases:records.length,formalCalls:0,actualBill:null}));
}
main().catch(()=>{console.error('Smoke blocked/failed. No credentials emitted. Check authorization, frozen files, ledger and credential environment.');process.exitCode=1;});
