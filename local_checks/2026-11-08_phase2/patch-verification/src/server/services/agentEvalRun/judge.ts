import type { GenerateObjectPayload } from '@lobechat/eval-rubric';
import type { GenerateObjectOptions, GenerateObjectSchema } from '@lobechat/model-runtime';
import type { EvalScoringErrorCode } from '@lobechat/types';

export class ScoringError extends Error {
  constructor(
    public readonly errorCode: EvalScoringErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ScoringError';
  }
}

interface JudgeRuntime {
  generateObject: (
    payload: {
      messages: GenerateObjectPayload['messages'];
      model: string;
      schema: GenerateObjectSchema;
    },
    options?: GenerateObjectOptions,
  ) => Promise<unknown>;
}

/** Hard deadline also covers initialization and providers which ignore cancellation. */
export async function generateJudgeObject(
  payload: GenerateObjectPayload,
  initialize: () => Promise<JudgeRuntime>,
) {
  const timeoutMs = payload.timeoutMs ?? 60_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
    throw new ScoringError('judge_config', 'Judge timeoutMs must be an integer from 100 to 60000');
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = Promise.resolve()
    .then(initialize)
    .then((runtime) => {
      controller.signal.throwIfAborted();
      return runtime.generateObject(
        {
          messages: payload.messages,
          model: payload.model,
          schema: {
            name: 'eval_judge_score',
            schema: payload.schema as GenerateObjectSchema['schema'],
          },
        },
        { signal: controller.signal },
      );
    });
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new ScoringError('judge_timeout', `LLM judge exceeded ${timeoutMs}ms deadline`);
      reject(error);
      controller.abort(error);
    }, timeoutMs);
  });
  try {
    // race registers a rejection handler on work, including a late rejection after timeout.
    const output = await Promise.race([work, deadline]);
    const value = output as { score?: unknown; reason?: unknown } | null;
    if (
      !value ||
      typeof value.score !== 'number' ||
      !Number.isFinite(value.score) ||
      value.score < 0 ||
      value.score > 1 ||
      typeof value.reason !== 'string' ||
      !value.reason.trim() ||
      (payload.scoreMode === 'binary' && value.score !== 0 && value.score !== 1)
    ) {
      throw new ScoringError(
        'judge_invalid_result',
        'LLM judge returned an invalid score or empty reason',
      );
    }
    return { score: value.score, reason: value.reason };
  } catch (error) {
    if (error instanceof ScoringError) throw error;
    if (
      error instanceof Error &&
      (error.name === 'StructuredOutputParseError' || error instanceof SyntaxError)
    ) {
      throw new ScoringError('judge_parse', 'LLM judge returned empty or invalid JSON');
    }
    throw new ScoringError(
      'judge_provider',
      error instanceof Error ? error.message : 'LLM judge provider failed',
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function scoringErrorCode(error: unknown): EvalScoringErrorCode {
  return error instanceof ScoringError ? error.errorCode : 'evaluation_config';
}
