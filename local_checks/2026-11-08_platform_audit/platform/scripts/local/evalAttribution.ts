/** Explicit single-host batch worker; run/case scores are never updated by this command. */
import { parseArgs } from 'node:util';

import { getServerDB } from '../../packages/database/src/core/db-adaptor';
import { AgentEvalAttributionService } from '../../src/server/services/agentEvalAttribution';

async function main() {
  const { values } = parseArgs({
    options: {
      'user-id': { type: 'string' },
      'run-id': { type: 'string' },
      limit: { type: 'string', default: '10' },
      'enqueue-only': { type: 'boolean', default: false },
      'process-only': { type: 'boolean', default: false },
    },
  });
  const userId = values['user-id'];
  if (!userId) throw new Error('Provide --user-id for the owner of the isolated evaluation');
  const limit = Number(values.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error('--limit must be between 1 and 100');
  const db = await getServerDB();
  const service = new AgentEvalAttributionService(db, userId);
  const queued = values['process-only'] ? [] : await service.enqueueRun(values['run-id'] ?? '');
  const processed = values['enqueue-only'] ? [] : await service.processPending(limit);
  console.info(
    JSON.stringify({
      queued,
      processed,
      note: 'Diagnosis tasks are separate from original evaluation scores.',
    }),
  );
  process.exitCode = processed.some((item) => item.job?.status === 'error') ? 1 : 0;
}
main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch(() => {
    console.error(
      'Attribution batch failed. Check owner/run identifiers, database configuration and EVAL_ATTRIBUTION_PYTHON.',
    );
    process.exit(1);
  });
