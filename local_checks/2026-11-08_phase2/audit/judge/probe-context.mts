import { writeFileSync } from 'node:fs';
import { match } from '../../../2026-11-08_platform_audit/platform/packages/eval-rubric/src/matchers/index.ts';

const records = [];
for (const type of ['llm-rubric', 'answer-relevance'] as const) {
  let captured;
  const result = await match({
    actual: 'SYNTHETIC_ACTUAL', expected: 'SYNTHETIC_EXPECTED', input: 'SYNTHETIC_QUESTION',
    rubric: { id: 'audit-only', name: 'audit-only', type, weight: 1,
      config: { criteria: 'SYNTHETIC_CRITERIA', model: 'synthetic', provider: 'synthetic' } },
  }, { generateObject: async (payload) => {
    captured = payload;
    return { reason: 'Synthetic controlled fixture; no HTTP request', score: 1 };
  } });
  const prompt = JSON.stringify(captured);
  records.push({ type, containsInput: prompt.includes('SYNTHETIC_QUESTION'),
    containsExpected: prompt.includes('SYNTHETIC_EXPECTED'), containsActual: prompt.includes('SYNTHETIC_ACTUAL'),
    containsCriteria: prompt.includes('SYNTHETIC_CRITERIA'), result });
}
writeFileSync(new URL('context-probe.json', import.meta.url), JSON.stringify({
  generatedAt: new Date().toISOString(), mode: 'local matcher + injected callback; no model/network', records,
}, null, 2));
console.log(JSON.stringify(records));
