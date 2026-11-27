import { readFile, writeFile } from 'node:fs/promises';
import { ModelRuntime } from '../../../2026-11-08_platform_audit/platform/packages/model-runtime/src/core/ModelRuntime';

async function main() {
  const [inputFile, outputFile, baseURL, mode = 'offline', provider = 'openai', model = 'mock-attribution-candidate'] = process.argv.slice(2);
  if (mode !== 'offline') throw new Error('real_model_blocked: no approved real provider/model credentials; no real request made');
  const url = new URL(baseURL);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || provider !== 'openai' || model !== 'mock-attribution-candidate') throw new Error('Offline mode accepts only explicit localhost controlled fixture');
  const input = JSON.parse(await readFile(inputFile, 'utf8'));
  const exchanges: unknown[] = [];
  const runtime = ModelRuntime.initializeWithProvider(provider, {
    apiKey: 'synthetic-local-key', baseURL,
    fetch: async (request, init) => {
      const response = await fetch(request, init);
      exchanges.push({ request: typeof init?.body === 'string' ? JSON.parse(init.body) : null, status: response.status, response: await response.clone().json() });
      return response;
    },
  });
  const results = [];
  for (const fixture of input.fixtures) {
    const output = await runtime.generateObject({
      model, messages: [
        { role: 'system', content: input.prompt + '\nExperiment output contract: return only diagnosis {status,category,moduleId,claimLevel,summary,evidenceRefs:[{nodeId,field,quote}],reasonCodes}. Legacy prompt is taxonomy context only.' },
        { role: 'user', content: JSON.stringify({ trajectory: fixture.trajectory, syntheticCandidate: fixture.candidate }) },
      ],
      schema: { name: 'attribution_candidate', schema: { type: 'object', additionalProperties: true } },
    });
    results.push({ id: fixture.id, output, exchange: exchanges.at(-1) });
  }
  await writeFile(outputFile, JSON.stringify({ conditions: { mode, provider, model, baseURL, controlledEcho: true, realModelBlocked: true }, results }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
