import type { MockTurn } from './types';

/** Stateless offline fixtures: model names select outcomes without changing global scenarios. */
export function judgeFixture(
  model: string,
  request: { messages?: unknown; response_format?: { type?: string } },
): MockTurn {
  const prompt = JSON.stringify(request.messages ?? []).toLowerCase();
  if (
    request.response_format?.type !== 'json_schema' ||
    !prompt.includes('[question]') ||
    (!prompt.includes('[output]') && !prompt.includes('[response]')) ||
    !prompt.includes('[criteria]')
  ) {
    return {
      error: {
        kind: 'http',
        status: 400,
        message: 'Offline judge requires schema, question, output and criteria context',
      },
    };
  }
  const reason = 'Offline deterministic fixture; validates engineering wiring, not model quality';
  switch (model) {
    case 'mock-judge-valid':
      return { content: JSON.stringify({ score: 1, reason }) };
    case 'mock-judge-zero':
      return { content: JSON.stringify({ score: 0, reason }) };
    case 'mock-judge-empty':
      return { content: '' };
    case 'mock-judge-invalid-json':
      return { content: '{invalid-json' };
    case 'mock-judge-out-of-range':
      return { content: JSON.stringify({ score: 2, reason }) };
    case 'mock-judge-empty-reason':
      return { content: JSON.stringify({ score: 1, reason: '' }) };
    case 'mock-judge-binary-half':
      return { content: JSON.stringify({ score: 0.5, reason }) };
    case 'mock-judge-error':
      return { error: { kind: 'http', status: 503, message: 'Offline judge unavailable' } };
    case 'mock-judge-timeout':
      return { error: { kind: 'timeout', holdMs: 120_000 } };
    default:
      return { error: { kind: 'http', status: 400, message: 'Unknown offline judge model' } };
  }
}
