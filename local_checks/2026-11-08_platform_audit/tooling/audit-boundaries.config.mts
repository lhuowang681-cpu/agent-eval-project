import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
export default defineConfig({
  root:import.meta.dirname,
  resolve:{alias:[{find:/^vitest$/,replacement:resolve(import.meta.dirname,'node_modules/vitest/dist/index.js')}]},
  test:{include:['audit-boundaries.test.ts'],environment:'node',maxWorkers:1,fileParallelism:false,setupFiles:['./audit-no-network.ts'],reporters:['default','json'],outputFile:{json:resolve(import.meta.dirname,'../results/boundary-tests.json')}},
});
