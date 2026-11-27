import assert from 'node:assert/strict';
import { persistedShadowRunner } from './runner';
async function main(){
 const input={score:0};const result={score:0,status:'failed'};let calls=0;const saved:any[]=[];
 const base=async()=>result;
 assert.equal(await persistedShadowRunner(base,{shadow:async()=>{calls++;},record:async o=>{saved.push(o);}})(input,{}),result);assert.equal(calls,0);
 assert.equal(await persistedShadowRunner(base,{enabled:true,shadow:async t=>{t.score=99;return {};},record:async o=>{saved.push(o);}})(input,{}),result);assert.equal(input.score,0);
 assert.equal(await persistedShadowRunner(base,{enabled:true,shadow:async()=>{throw Error('any provider failure');},record:async o=>{saved.push(o);}})(input,{}),result);assert.equal(saved.at(-1).status,'error');
 assert.equal(await persistedShadowRunner(base,{enabled:true,shadow:async()=>({}),record:async()=>{throw Error('db failure');}})(input,{}),result);
 await assert.rejects(persistedShadowRunner(async()=>{throw Error('base error');},{enabled:true,shadow:async()=>{calls++;},record:async()=>{}})(input,{}));assert.equal(calls,0);
 console.log(JSON.stringify({tests:5,passed:5}));
}
main().catch(()=>{process.exitCode=1;});
