import { defineConfig } from 'vitest/config';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const req=createRequire(import.meta.url);
export default defineConfig({
  root:resolve(import.meta.dirname,'../platform'),
  resolve:{alias:[{find:/^vitest$/,replacement:resolve(import.meta.dirname,'node_modules/vitest/dist/index.js')},...['p-map','ajv','papaparse','xlsx','tokenx'].map(name=>({find:new RegExp('^'+name+'$'),replacement:req.resolve(name)}))]},
  test:{
    include:['packages/agent-runtime/src/**/*.test.ts','packages/eval-rubric/**/*.test.ts','packages/eval-dataset-parser/**/*.test.ts'],
    environment:'node', globals:true, maxWorkers:1,fileParallelism:false,
    testTimeout:10000,hookTimeout:20000,
    setupFiles:[resolve(import.meta.dirname,'audit-no-network.ts')],
    reporters:['default','json'], outputFile:{json:resolve(import.meta.dirname,'../results/core-tests.json')},
  },
});
