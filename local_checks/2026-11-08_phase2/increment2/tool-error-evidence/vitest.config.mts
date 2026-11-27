import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../2026-11-08_platform_audit/platform/', import.meta.url));
export default {
  root,
  resolve: { alias: [{ find: /^vitest$/, replacement: resolve(root, 'node_modules/vitest/dist/index.js') }] },
  test: {
    include: ['packages/builtin-tool-calculator/src/**/*.test.ts'],
    environment: 'node', maxWorkers: 1, fileParallelism: false,
    testTimeout: 20000, hookTimeout: 60000,
  },
};
