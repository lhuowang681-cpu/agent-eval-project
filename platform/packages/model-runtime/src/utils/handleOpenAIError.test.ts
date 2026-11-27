import OpenAI from 'openai';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AgentRuntimeErrorType } from '../types/error';
import { handleOpenAIError } from './handleOpenAIError';

describe('handleOpenAIError', () => {
  // The no-body fallback emits a temporary instrumentation warning; silence it
  // in tests so it doesn't pollute output, while still asserting it fires.
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('OpenAI APIError handling', () => {
    it('should handle OpenAI APIError with error object', () => {
      const apiError = new OpenAI.APIError(
        472,
        { error: { message: 'API error', type: 'invalid_request' } },
        'test-message',
        { status: 400 } as any,
      );

      const result = handleOpenAIError(apiError);

      expect(result).toEqual({
        errorResult: { error: { message: 'API error', type: 'invalid_request' } },
      });
      expect(result.RuntimeError).toBeUndefined();
    });

    it('should handle OpenAI APIError with cause', () => {
      const cause = { message: 'Network error', code: 'ECONNRESET' };
      const apiError = new OpenAI.APIError(472, null as any, 'test-message', {
        status: 500,
      } as any);
      (apiError as any).cause = cause;

      const result = handleOpenAIError(apiError);

      expect(result).toEqual({
        errorResult: cause,
      });
      expect(result.RuntimeError).toBeUndefined();
    });

    it('should handle OpenAI APIError without error or cause', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const headers = { 'content-type': 'application/json' };
      const apiError = new OpenAI.APIError(472, null as any, 'test-message', {
        status: 401,
        headers,
      } as any);

      const result = handleOpenAIError(apiError);

      // Fix: the fallback now surfaces `error.message` so clients no longer see an
      // empty `{}` body when the upstream returns no parseable error body.
      // (The OpenAI SDK formats APIError.message as `${status} ${message}`.)
      expect(result.errorResult).toEqual({
        headers: { headers, status: 401 },
        message: '472 test-message',
        status: 472,
      });
      expect(result.RuntimeError).toBeUndefined();
      // Temp instrumentation should fire for the no-body case.
      expect(warnSpy).toHaveBeenCalled();
    });

    it('should surface message for transport/abort errors with undefined status', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      // Mirrors `APIUserAbortedError` / `APIConnectionError`: status/headers/error
      // all undefined, only `message` carries a hint ("Request was aborted.").
      const apiError = new OpenAI.APIError(
        undefined as any,
        undefined as any,
        'Request was aborted.',
        undefined as any,
      );

      const result = handleOpenAIError(apiError);

      expect(result.errorResult).toEqual({
        headers: undefined,
        message: 'Request was aborted.',
        status: undefined,
      });
    });

    it('should handle OpenAI APIError with both error and cause', () => {
      const errorObject = { message: 'API error', type: 'rate_limit' };
      const cause = { message: 'Rate limit exceeded' };
      const apiError = new OpenAI.APIError(472, { error: errorObject }, 'test-message', {
        status: 429,
      } as any);
      (apiError as any).cause = cause;

      const result = handleOpenAIError(apiError);

      // Should prioritize error over cause
      expect(result).toEqual({
        errorResult: { error: errorObject },
      });
    });
  });

  describe('Non-OpenAI error handling', () => {
    it('should handle generic Error', () => {
      const error = new Error('Generic error');
      error.cause = { details: 'Error details' };

      const result = handleOpenAIError(error);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: { details: 'Error details' },
          message: 'Generic error',
          name: 'Error',
        },
      });
    });

    it('should handle Error without cause', () => {
      const error = new Error('Simple error');

      const result = handleOpenAIError(error);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: undefined,
          message: 'Simple error',
          name: 'Error',
        },
      });
    });

    it('should handle custom Error types', () => {
      class CustomError extends Error {
        constructor(message: string) {
          super(message);
          this.name = 'CustomError';
        }
      }

      const error = new CustomError('Custom error message');
      const result = handleOpenAIError(error);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: undefined,
          message: 'Custom error message',
          name: 'CustomError',
        },
      });
    });

    it('should handle non-Error objects', () => {
      const errorObject = {
        message: 'Object error',
        code: 'CUSTOM_ERROR',
      };

      const result = handleOpenAIError(errorObject);

      expect(result).toEqual({
        RuntimeError: AgentRuntimeErrorType.AgentRuntimeError,
        errorResult: {
          cause: undefined,
          message: 'Object error',
          name: undefined,
        },
      });
    });
  });
});
