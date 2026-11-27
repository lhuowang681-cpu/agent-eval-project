import { ChatErrorType, type ChatMessageError } from '@lobechat/types';

/** Virtual user turn appended after partial assistant content for stream continuation */
export const STREAM_CONTINUE_USER_PROMPT =
  'Please continue your previous response exactly from where you stopped. Do not repeat any content you have already written.';

/**
 * Build LLM messages for stream continuation.
 * Providers reject requests ending with an assistant message (HTTP 400),
 * so we append a virtual user prompt after the partial assistant turn.
 */
export const buildStreamContinueMessages = <
  T extends { content?: string | null; id?: string; role: string },
>(
  messages: T[],
  assistantMessageId: string,
  partialContent: string,
): T[] => {
  const baseMessages = messages.filter((message) => message.id !== assistantMessageId);

  if (!partialContent) return baseMessages;

  return [
    ...baseMessages,
    { content: partialContent, role: 'assistant' } as T,
    { content: STREAM_CONTINUE_USER_PROMPT, role: 'user' } as T,
  ];
};

export const isUnexpectedEndError = (error?: ChatMessageError): boolean => {
  if (!error) return false;

  const body = error.body as { reason?: string } | undefined;

  return body?.reason === 'unexpected_end';
};

export const isRecoverableStreamError = (error?: ChatMessageError): boolean => {
  if (!error) return false;

  // Connection dropped after streaming had already started — surfaced by fetchSSE
  // as ConnectionAborted (e.g. gateway idle-timeout or a network blip mid-stream).
  // Partial content is already on the message, so treat it as recoverable and let
  // stream continuation resume from where it stopped, instead of leaving a dead
  // error the user can only "regenerate" from scratch.
  if (error.type === ChatErrorType.ConnectionAborted) return true;

  const body = error.body as { reason?: string } | undefined;
  const reason = body?.reason;

  return reason === 'unexpected_end' || reason === 'aborted';
};

/**
 * Detect content-moderation blocks (e.g. ada gateway `DataInspectionFailed:
 * Output data may contain inappropriate content.`). These are transient — the
 * same input often passes on re-sampling — so the first occurrence is worth one
 * auto-continue attempt before surfacing a user-facing error.
 */
export const isContentModerationError = (error?: ChatMessageError): boolean => {
  if (!error) return false;

  const text = `${error.message ?? ''} ${(error.body as { message?: string } | undefined)?.message ?? ''}`;
  return /DataInspectionFailed|inappropriate content/i.test(text);
};

export const isLengthStopReason = (stopReason?: string): boolean => {
  if (!stopReason) return false;

  return stopReason === 'length' || stopReason === 'max_tokens';
};

/**
 * Normalize finish type for stream recovery.
 * Handles races where the SSE layer reports `done` but the user already cancelled,
 * or the model stopped due to max output tokens (`length`).
 */
export const resolveEffectiveFinishType = (params: {
  finishType?: string;
  isUserCancelled?: boolean;
  stopReason?: string;
}): string | undefined => {
  const { finishType, isUserCancelled, stopReason } = params;

  if (finishType === 'done' && isUserCancelled) return 'abort';
  if (finishType === 'done' && isLengthStopReason(stopReason)) return 'incomplete';

  return finishType;
};

export const isStreamInterrupted = (params: {
  finishType?: string;
  lastStreamError?: ChatMessageError;
}): boolean => {
  const { finishType, lastStreamError } = params;

  return (
    finishType === 'incomplete' ||
    (finishType === 'error' && isRecoverableStreamError(lastStreamError))
  );
};

export const shouldAttemptAutoContinue = (params: {
  contentLength: number;
  finishType?: string;
  hasToolCalls: boolean;
  isContinuation?: boolean;
  isUserCancelled?: boolean;
  lastStreamError?: ChatMessageError;
  stopReason?: string;
}): boolean => {
  const {
    finishType,
    hasToolCalls,
    contentLength,
    lastStreamError,
    isContinuation,
    isUserCancelled,
    stopReason,
  } = params;

  const effectiveFinishType = resolveEffectiveFinishType({
    finishType,
    isUserCancelled,
    stopReason,
  });

  if (effectiveFinishType === 'abort') return false;
  if (hasToolCalls) return false;

  // Content-moderation block (ada DataInspectionFailed): give the model one
  // continuation attempt — re-sampling often lands on non-flagged output. The
  // `isContinuation` guard below prevents a second retry, so a repeated block
  // falls through to a typed error that the UI surfaces with a clear message.
  if (!isContinuation && !isUserCancelled && isContentModerationError(lastStreamError)) {
    return true;
  }

  if (contentLength === 0) {
    // Anomalous empty completion: the model finished a turn with no content AND no
    // tool calls (often a clean `done`/`stop`). That should never be a real answer,
    // so retry it ONCE to give the model another chance — but not if this stream is
    // already a continuation (avoids retry loops) and not on a fatal error stream
    // (those keep surfacing their error). The caller marks the message incomplete
    // when the retry is still empty, which then shows the "continue" banner.
    if (isContinuation) return false;
    if (effectiveFinishType === 'error') return false;
    return true;
  }

  if (effectiveFinishType === 'incomplete') return true;

  if (effectiveFinishType === 'error' && isRecoverableStreamError(lastStreamError)) return true;

  return false;
};

export const shouldShowIncompleteBanner = (params: {
  contentLength: number;
  finishType?: string;
  hasToolCalls: boolean;
  isUserCancelled?: boolean;
  lastStreamError?: ChatMessageError;
  stopReason?: string;
}): boolean => {
  const { finishType, hasToolCalls, contentLength, lastStreamError, isUserCancelled, stopReason } =
    params;

  if (!hasToolCalls && contentLength === 0) return false;

  const effectiveFinishType = resolveEffectiveFinishType({
    finishType,
    isUserCancelled,
    stopReason,
  });

  if (effectiveFinishType === 'abort') {
    return hasToolCalls || contentLength > 0;
  }

  if (hasToolCalls && isStreamInterrupted({ finishType: effectiveFinishType, lastStreamError })) {
    return true;
  }

  if (!isStreamInterrupted({ finishType: effectiveFinishType, lastStreamError })) {
    return false;
  }

  // Text stream: banner only when auto-retry will not run for this interrupt
  return !shouldAttemptAutoContinue(params);
};
