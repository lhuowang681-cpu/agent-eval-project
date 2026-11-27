import {describe,it,expect,vi} from 'vitest';
import {eq} from 'drizzle-orm';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {getTestDB} from '@/database/core/getTestDB';
import {agents,users,messages,agentEvalDatasets} from '@/database/schemas';
import {AgentEvalBenchmarkModel,AgentEvalDatasetModel,AgentEvalTestCaseModel,AgentEvalRunModel,AgentEvalRunTopicModel} from '@/database/models/agentEval';
import {AgentEvalRunService} from '@/server/services/agentEvalRun';
import {parseDataset} from '../platform/packages/eval-dataset-parser/src';
const execMock=vi.hoisted(()=>vi.fn());
vi.mock('@/server/services/aiAgent',()=>({AiAgentService:vi.fn().mockImplementation(()=>({execAgent:execMock}))}));
vi.mock('@/server/services/agentRuntime/AgentRuntimeService',()=>({AgentRuntimeService:vi.fn().mockImplementation(()=>({interruptOperation:vi.fn()}))}));
const db=await getTestDB();
describe('Three-case service integration with a synthetic execution substitute',()=>{
 it('persists config, imports cases, runs callbacks/scores, and compares an amended config',async()=>{
  const uid='audit-three-cases';await db.insert(users).values({id:uid});
  const [agent]=await db.insert(agents).values({userId:uid,title:'Audit Agent',model:'synthetic-model',provider:'audit',systemRole:'v1'}).returning();
  const bm=new AgentEvalBenchmarkModel(db,uid), dm=new AgentEvalDatasetModel(db,uid),tm=new AgentEvalTestCaseModel(db,uid),rm=new AgentEvalRunModel(db,uid),rt=new AgentEvalRunTopicModel(db,uid);
  const b=await bm.create({name:'Audit benchmark',identifier:'audit-three',isSystem:false,rubrics:[{id:'eq',name:'equals',type:'equals',config:{},weight:1}]});
  const ds=await dm.create({benchmarkId:b.id,name:'Three cases',identifier:'three',evalMode:'equals'} as any);
  const parsed=parseDataset(' {"input":"Q1","expected":"42"}\n{"input":"Q2","expected":"Paris"}\n{"input":"Q3","expected":"yes"}',{format:'jsonl'});
  expect(parsed.totalCount).toBe(3);
  const cases=await tm.batchCreate(parsed.rows.map((r:any,i:number)=>({datasetId:ds.id,content:r,sortOrder:i})));
  const service=new AgentEvalRunService(db,uid);
  const run=async(name:string,outputs:string[])=>{
   const r=await service.createRun({datasetId:ds.id,targetAgentId:agent.id,name});
   await rm.update(r.id,{status:'running',metrics:{totalCases:3} as any});
   for(let i=0;i<cases.length;i++){
    let captured:any;
    execMock.mockImplementationOnce(async(p:any)=>{captured=p;return {operationId:'synthetic-op-'+r.id+'-'+i};});
    const result=await service.executeTrajectory({run:r,runId:r.id,testCaseId:cases[i].id,testCase:cases[i] as any});
    await db.insert(messages).values({userId:uid,role:'assistant',content:outputs[i],topicId:result.topicId});
    await captured.hooks[0].handler({status:'done',reason:'stop',duration:10,totalTokens:5,llmCalls:1,toolCalls:0,steps:1});
   }
   return {run:await rm.findById(r.id),cases:await rt.findByRunId(r.id)};
  };
  const before=await run('v1',['42','wrong','yes']);
  expect(before.run?.metrics?.passedCases).toBe(2);expect(before.run?.metrics?.failedCases).toBe(1);
  await db.update(agents).set({systemRole:'v2'}).where(eq(agents.id,agent.id));
  const after=await run('v2',['42','Paris','yes']);
  expect(after.run?.metrics?.passedCases).toBe(3);expect(after.run?.metrics?.failedCases).toBe(0);
  expect((before.run?.config as any).agentSnapshot.systemRole).toBe('v1');
  expect((after.run?.config as any).agentSnapshot.systemRole).toBe('v2');
  expect(before.cases.every((c:any)=>c.evalResult?.operationId)).toBe(true);
  await db.update(agentEvalDatasets).set({evalMode:'llm-rubric'}).where(eq(agentEvalDatasets.id,ds.id));
  const judgeRun=await run('llm-judge-context-check',['42','Paris','yes']);
  expect(judgeRun.run?.metrics?.passedCases).toBe(0);
  expect(judgeRun.cases.every((c:any)=>c.evalResult?.rubricScores?.some((r:any)=>r.reason==='LLM judge not available'))).toBe(true);
  writeFileSync(resolve(import.meta.dirname,'../results/three-case-flow-detail.json'),JSON.stringify({conditions:'PGlite + actual parser/models/eval service/rubric; AiAgentService.execAgent synthetic substitute; no actual model/tool execution or HTTP/browser. Judge run characterizes a missing injected judge context, not model failure.',before,after,judgeRun},null,2));
 });
});
