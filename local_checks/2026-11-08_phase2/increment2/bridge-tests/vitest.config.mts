export default {
 root: 'C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_platform_audit/platform',
 test:{environment:'node',include:['src/server/services/agentEvalAttribution/__tests__/contracts.test.ts','src/server/services/agentEvalAttribution/__tests__/python.integration.test.ts'],maxWorkers:1,fileParallelism:false,testTimeout:20000,reporters:['default','json'],outputFile:{json:'C:/Users/1/Desktop/就业agent/agent-eval-project/local_checks/2026-11-08_phase2/increment2/bridge-tests/results.json'}}
};
