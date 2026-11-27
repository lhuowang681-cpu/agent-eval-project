import { readFile,writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve,dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPython } from '../../2026-11-08_platform_audit/platform/src/server/services/agentEvalAttribution/python';
import { createShadowRunner } from './runner';
async function main() {
 const [inputFile,outputFile,python]=process.argv.slice(2);const envelope=JSON.parse(await readFile(inputFile,'utf8'));let artifact:unknown;
 const runner=createShadowRunner(runPython,{enabled:true,timeoutMs:10000,record:async v=>{artifact=v;},shadow:async(input,signal)=>new Promise((res,rej)=>{
  const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
  const child=spawn(python,['-E','-s','-X','utf8',resolve(root,'sidecar.py')],{cwd:root,windowsHide:true,env:{PATH:process.env.PATH,SystemRoot:process.env.SystemRoot},signal});
  let data='';child.stdout.on('data',c=>{data+=c;if(data.length>1048576){child.kill();rej(Error('limit'));}});child.on('error',rej);child.on('close',code=>{try{code===0?res(JSON.parse(data)):rej(Error('sidecar_exit'));}catch(e){rej(e);}});child.stdin.end(JSON.stringify({...envelope,trajectory:input}));
 })});
 const before=JSON.stringify(envelope.trajectory);const result=await runner(envelope.trajectory);
 if (before!==JSON.stringify(envelope.trajectory)||!artifact)throw Error('missing_shadow_or_input_changed');
 await writeFile(outputFile,JSON.stringify({result,artifact,inputUnchanged:true,databaseRunNotPerformed:true},null,2));console.log('actual_runPython_to_shadow_passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
