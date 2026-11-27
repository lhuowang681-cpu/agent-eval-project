import { createShadowRunner } from '../previous/integration/runner';
/** Uses the existing isolation wrapper; errors are independent persistence records. */
export function persistedShadowRunner<I,D,O>(base:(input:I,options:O)=>Promise<D>, config:{enabled?:boolean;timeoutMs?:number;shadow:(input:I,signal:AbortSignal)=>Promise<unknown>;record:(outcome:any,input:I)=>Promise<void>}){
 return (input:I,options:O)=>createShadowRunner((t:I)=>base(t,options),{
  enabled:config.enabled===true,timeoutMs:config.timeoutMs??12000,
  shadow:async(t,signal)=>{try{return {status:'success',artifact:await config.shadow(t,signal)};}catch(error:any){return {status:'error',errorCode:error?.code==='python_timeout'?'python_timeout':'shadow_error'};}},
  record:outcome=>config.record(outcome,input),
 })(input);
}
