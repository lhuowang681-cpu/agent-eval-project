import type { ChatMessageError } from '@lobechat/types';
import { describe, expect, it } from 'vitest';

import {
  buildStreamContinueMessages,
  isContentModerationError,
  isRecoverableStreamError,
  isUnexpectedEndError,
  resolveEffectiveFinishType,
  shouldAttemptAutoContinue,
  shouldShowIncompleteBanner,
  STREAM_CONTINUE_USER_PROMPT,
} from './streamRecovery';

describe('streamRecovery', () => {
  const unexpectedEndError: ChatMessageError = {
    body: { reason: 'unexpected_end' },
    message: 'Stream ended unexpectedly',
    type: 'StreamChunkError',
  };

  it('detects unexpected_end errors', () => {
    expect(isUnexpectedEndError(unexpectedEndError)).toBe(true);
    expect(isUnexpectedEndError({ body: {}, message: 'x', type: 'UnknownChatFetchError' })).toBe(
      false,
    );
  });

  // Mid-stream connection drop surfaced by fetchSSE: type is ConnectionAborted and
  // body carries no `reason` field (only message/name/stack).
  const connectionAbortedError: ChatMessageError = {
    body: { message: 'network error', name: 'TypeError' },
    message: 'Connection aborted during streaming',
    type: 'ConnectionAborted',
  };

  it('detects recoverable stream errors including aborted', () => {
    expect(isRecoverableStreamError(unexpectedEndError)).toBe(true);
    expect(
      isRecoverableStreamError({
        body: { reason: 'aborted' },
        message: 'Stream cancelled',
        type: 'StreamChunkError',
      }),
    ).toBe(true);
  });

  it('treats ConnectionAborted (mid-stream drop) as recoverable', () => {
    // Regression: fetchSSE classifies a mid-stream connection drop as
    // ConnectionAborted with no body.reason, so reason-only detection missed it
    // and the partial answer was left as a dead error instead of being continued.
    expect(isRecoverableStreamError(connectionAbortedError)).toBe(true);
  });

  it('auto-continues a ConnectionAborted stream that already has content', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 4668,
        finishType: 'error',
        hasToolCalls: false,
        lastStreamError: connectionAbortedError,
      }),
    ).toBe(true);
  });

  it('does not auto-continue ConnectionAborted with no content yet', () => {
    // Connection died before any content streamed — the lower fetchSSE network
    // retry owns this case; here we must not spin up a no-op continuation.
    expect(
      shouldAttemptAutoContinue({
        contentLength: 0,
        finishType: 'error',
        hasToolCalls: false,
        lastStreamError: connectionAbortedError,
      }),
    ).toBe(false);
  });

  it('resolves done to abort when user cancelled', () => {
    expect(
      resolveEffectiveFinishType({
        finishType: 'done',
        isUserCancelled: true,
      }),
    ).toBe('abort');
  });

  it('resolves done to incomplete for length stop reason', () => {
    expect(
      resolveEffectiveFinishType({
        finishType: 'done',
        stopReason: 'length',
      }),
    ).toBe('incomplete');
  });

  it('allows auto-continue for each interrupt with content', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 10,
        finishType: 'incomplete',
        hasToolCalls: false,
      }),
    ).toBe(true);

    // Still retries on subsequent length stops within the same answer
    expect(
      shouldAttemptAutoContinue({
        contentLength: 5000,
        finishType: 'done',
        hasToolCalls: false,
        stopReason: 'length',
      }),
    ).toBe(true);
  });

  it('blocks auto-continue for tool calls', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 10,
        finishType: 'incomplete',
        hasToolCalls: true,
      }),
    ).toBe(false);
  });

  it('retries an anomalous empty turn once, then stops on the continuation', () => {
    // Empty content + no tool calls + clean finish: the model produced nothing.
    // First attempt should auto-retry...
    expect(
      shouldAttemptAutoContinue({
        contentLength: 0,
        finishType: 'done',
        hasToolCalls: false,
      }),
    ).toBe(true);

    // ...but an already-continued empty stream must NOT retry again (no loop);
    // it falls through to the incomplete banner instead.
    expect(
      shouldAttemptAutoContinue({
        contentLength: 0,
        finishType: 'done',
        hasToolCalls: false,
        isContinuation: true,
      }),
    ).toBe(false);
  });

  it('does not retry an empty turn that ended in a fatal error', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 0,
        finishType: 'error',
        hasToolCalls: false,
        lastStreamError: { type: 'PluginServerError' } as ChatMessageError,
      }),
    ).toBe(false);
  });

  it('does not retry an empty turn the user cancelled', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 0,
        finishType: 'done',
        hasToolCalls: false,
        isUserCancelled: true,
      }),
    ).toBe(false);
  });

  // ada gateway content-moderation block: transient (re-sampling often passes),
  // so the first occurrence retries once; a repeated block on the continuation
  // falls through to a typed error the UI surfaces with a clear message.
  const contentModerationError: ChatMessageError = {
    body: {
      message:
        '<400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content.',
      provider: 'ada',
      errorType: 'ProviderBizError',
    },
    message:
      '<400> InternalError.Algo.DataInspectionFailed: Output data may contain inappropriate content.',
    type: 'ProviderBizError',
  };

  it('detects content-moderation blocks', () => {
    expect(isContentModerationError(contentModerationError)).toBe(true);
    expect(
      isContentModerationError({
        body: { message: 'Output may contain inappropriate content.' },
        message: 'x',
        type: 'ProviderBizError',
      }),
    ).toBe(true);
    expect(isContentModerationError(unexpectedEndError)).toBe(false);
    expect(isContentModerationError(undefined)).toBe(false);
  });

  it('auto-continues once on a content-moderation block', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 1146,
        finishType: 'error',
        hasToolCalls: false,
        lastStreamError: contentModerationError,
      }),
    ).toBe(true);

    // Empty content block also retries (continuation re-samples from scratch).
    expect(
      shouldAttemptAutoContinue({
        contentLength: 0,
        finishType: 'error',
        hasToolCalls: false,
        lastStreamError: contentModerationError,
      }),
    ).toBe(true);
  });

  it('does not retry a content-moderation block on the continuation', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 0,
        finishType: 'error',
        hasToolCalls: false,
        isContinuation: true,
        lastStreamError: contentModerationError,
      }),
    ).toBe(false);
  });

  it('does not auto-continue a content-moderation block mid tool-call', () => {
    expect(
      shouldAttemptAutoContinue({
        contentLength: 10,
        finishType: 'error',
        hasToolCalls: true,
        lastStreamError: contentModerationError,
      }),
    ).toBe(false);
  });

  it('surfaces a content-moderation block as an error card, not an incomplete banner', () => {
    expect(
      shouldShowIncompleteBanner({
        contentLength: 0,
        finishType: 'error',
        hasToolCalls: false,
        lastStreamError: contentModerationError,
      }),
    ).toBe(false);
  });

  it('hides incomplete banner while auto-retry will run', () => {
    expect(
      shouldShowIncompleteBanner({
        contentLength: 10,
        finishType: 'incomplete',
        hasToolCalls: false,
      }),
    ).toBe(false);
  });

  it('keeps banner hidden when recoverable error will auto-retry', () => {
    expect(
      shouldShowIncompleteBanner({
        contentLength: 10,
        finishType: 'error',
        hasToolCalls: false,
        lastStreamError: unexpectedEndError,
      }),
    ).toBe(false);
  });

  it('shows incomplete banner immediately for interrupted tool calls', () => {
    expect(
      shouldShowIncompleteBanner({
        contentLength: 0,
        finishType: 'incomplete',
        hasToolCalls: true,
      }),
    ).toBe(true);
  });

  it('shows incomplete banner when user cancelled with partial content', () => {
    expect(
      shouldShowIncompleteBanner({
        contentLength: 120,
        finishType: 'done',
        hasToolCalls: false,
        isUserCancelled: true,
      }),
    ).toBe(true);
  });

  it('builds continue messages with partial assistant and trailing user prompt', () => {
    const result = buildStreamContinueMessages(
      [
        { id: 'user-1', role: 'user', content: 'Hello' },
        { id: 'assistant-1', role: 'assistant', content: 'Partial reply' },
      ],
      'assistant-1',
      'Partial reply',
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ id: 'user-1', role: 'user', content: 'Hello' });
    expect(result[1]).toEqual({ role: 'assistant', content: 'Partial reply' });
    expect(result[2]).toEqual({ role: 'user', content: STREAM_CONTINUE_USER_PROMPT });
  });
});
