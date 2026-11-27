import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../../2026-11-08_platform_audit/platform/', import.meta.url));
export default { root, resolve: { alias: [{find:/^vitest$/,replacement:resolve(root,'node_modules/vitest/dist/index.js')}] }, test: { include:['tools/mock-llm/attributionFixture.test.ts'],environment:'node',maxWorkers:1 } };
