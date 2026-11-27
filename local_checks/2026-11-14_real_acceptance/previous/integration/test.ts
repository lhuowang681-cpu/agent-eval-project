import assert from 'node:assert/strict';
import { createShadowRunner } from './runner';
async function main() {
 const input={score:0,scope:{caseId:'test'}}; const original={score:0,status:'failed'}; let calls=0;
 const base=async()=>original;
 const disabled=createShadowRunner(base,{shadow:async()=>{calls++;},record:async()=>{}});
 assert.equal(await disabled(input),original);assert.equal(calls,0);
 let saved:unknown;
 const enabled=createShadowRunner(base,{enabled:true,shadow:async(t)=>{t.score=99;return {scope:t.scope};},record:async v=>{saved=v;}});
 assert.equal(await enabled(input),original);assert.equal(input.score,0);assert.ok(saved);
 const failure=createShadowRunner(base,{enabled:true,shadow:async()=>{throw Error('provider');},record:async()=>{throw Error('sink');}});
 assert.equal(await failure(input),original);
 const badSink=createShadowRunner(base,{enabled:true,shadow:async()=>({}),record:async()=>{throw Error('sink');}});
 assert.equal(await badSink(input),original);
 let late=0;
 const timeout=createShadowRunner(base,{enabled:true,timeoutMs:5,shadow:async()=>{await new Promise(r=>setTimeout(r,25));return {};},record:async()=>{late++;}});
 assert.equal(await timeout(input),original);await new Promise(r=>setTimeout(r,35));assert.equal(late,0);
 const baseFailure=createShadowRunner(async()=>{throw Error('base');},{enabled:true,shadow:async()=>{calls++;},record:async()=>{}});
 await assert.rejects(baseFailure(input));assert.equal(calls,0);
 console.log(JSON.stringify({tests:6,passed:6}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
