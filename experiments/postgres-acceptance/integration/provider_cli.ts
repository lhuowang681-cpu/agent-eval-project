import { readFile,writeFile } from 'node:fs/promises';
import { createProvider } from './provider';
async function main(){
 const [inputPath,outputPath]=process.argv.slice(2);const request=JSON.parse(await readFile(inputPath,'utf8'));
 const config=request.config??{};
 // Explicit env name only; do not read or serialize an entire environment.
 if(typeof config.apiKeyEnv!=='string'||!/^[A-Z_][A-Z0-9_]*$/.test(config.apiKeyEnv))throw Error('api_key_env_name_required');
 const provider=createProvider({...config,enabled:config.enabled===true,approvedRequests:config.approvedRequests??0,apiKey:process.env[config.apiKeyEnv]??''});
 const result=await provider.generate(request.trajectory,request.origin);
 await writeFile(outputPath,JSON.stringify(result,null,2));
}
main().catch(()=>{console.error('Provider blocked or failed; inspect budget, explicit configuration, privacy and schema. Credentials and supplier error bodies are not emitted.');process.exitCode=1;});
