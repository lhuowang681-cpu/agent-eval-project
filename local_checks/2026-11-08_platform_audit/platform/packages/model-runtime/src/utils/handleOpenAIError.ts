import OpenAI from 'openai';

import { AgentRuntimeErrorType } from '../types/error';

export const handleOpenAIError = (
  error: any,
): { RuntimeError?: 'AgentRuntimeError'; errorResult: any } => {
  let errorResult: any;

  // Check if the error is an OpenAI APIError
  if (error instanceof OpenAI.APIError) {
    // if error is definitely OpenAI APIError, there will be an error object
    if (error.error) {
      errorResult = error.error;
    }
    // Or if there is a cause, we use error cause
    // This often happened when there is a bug of the `openai` package.
    else if (error.cause) {
      errorResult = error.cause;
    }
    // if there is no other request error, the error object is a Response like object.
    // APIError extends Error, so `error.message` always carries a human-readable hint
    // such as "403 status code (no body)" or "Request was aborted.". Previously this
    // branch returned only `{ headers, status }`, and when both were `undefined`
    // (transport failures / user aborts) `JSON.stringify` produced `{}` — the client
    // saw an empty error body with no clue. Surface `message` so the client always
    // gets *something* actionable.
    else {
      errorResult = {
        headers: error.headers,
        message: error.message,
        status: error.status,
      };

      // TEMP INSTRUMENTATION (2026-06-25): log upstream errors that arrive with no
      // parsed body, to identify the tripflow 4xx "no body" root cause (e.g. a 93-byte
      // 403 body the SDK failed to parse into `error.error`). Remove once located.

      console.warn(
        `[handleOpenAIError][temp-instrumentation] no parsed body: status=${error.status} message=${error.message} request_id=${error.request_id} code=${error.code} type=${error.type} headers=${JSON.stringify(error.headers)} error.error=${JSON.stringify(error.error)}`,
      );
    }

    return {
      errorResult,
    };
  } else {
    const err = error as Error;

    errorResult = { cause: err.cause, message: err.message, name: err.name };

    return {
      RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
      errorResult,
    };
  }
};
