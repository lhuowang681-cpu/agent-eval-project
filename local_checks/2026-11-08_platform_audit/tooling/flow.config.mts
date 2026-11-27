import original from '../platform/vitest.config.mts';
import {resolve} from 'node:path';
export default {...original, root:resolve(import.meta.dirname,'..'),
 resolve:{alias:[{find:/^vitest$/,replacement:resolve(import.meta.dirname,'../platform/node_modules/vitest/dist/index.js')}]},
 test:{...original.test,include:['tooling/flow.test.ts'],environment:'node',maxWorkers:1,fileParallelism:false,testTimeout:30000,hookTimeout:60000,reporters:['default','json'],outputFile:{json:resolve(import.meta.dirname,'../results/three-case-flow.json')}},
};
