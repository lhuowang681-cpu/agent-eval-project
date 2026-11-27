import { LOBE_CHAT_OBSERVATION_ID, LOBE_CHAT_TRACE_ID, MESSAGE_CANCEL_FLAT } from '@lobechat/const';
import { parseToolCalls } from '@lobechat/model-runtime';
import type {
  ChatImageChunk,
  ChatMessageError,
  GroundingSearch,
  MessageToolCall,
  ModelPerformance,
  ModelReasoning,
  ModelUsage,
  ResponseAnimation,
  ResponseAnimationStyle,
} from '@lobechat/types';
import { ChatErrorType } from '@lobechat/types';
import { fetchEventSource } from '@lobechat/utils/client/fetchEventSource/index';
import { nanoid } from '@lobechat/utils/uuid';

import { getMessageError } from './parseError';

type SSEFinishType = 'done' | 'error' | 'abort' | 'incomplete' | string;

// Network-error retry configuration for fetchSSE.
// Triggered when the underlying fetch() fails with a TypeError before any
// HTTP response is received (e.g. "Failed to fetch" / "network error" / "Load failed").
const MAX_NETWORK_RETRY = 2;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 5000;

/**
 * Detects whether the error thrown by fetch() is a network-layer failure
 * (no HTTP response received). Matches the cross-browser TypeError messages:
 *  - "Failed to fetch" (Chromium)
 *  - "network error"   (Firefox / some Chromium)
 *  - "Load failed"     (Safari)
 *  - "NetworkError"    (IE / Edge Legacy)
 */
const isNetworkError = (error: any): boolean => {
  if (!error) return false;
  const name = String(error.name || '');
  const message = String(error.message || '').toLowerCase();

  if (name !== 'TypeError' && name !== 'NetworkError') return false;

  return /failed to fetch|network error|load failed|networkerror/.test(message);
};

export type OnFinishHandler = (
  text: string,
  context: {
    grounding?: GroundingSearch;
    images?: ChatImageChunk[];
    observationId?: string | null;
    reasoning?: ModelReasoning;
    speed?: ModelPerformance;
    toolCalls?: MessageToolCall[];
    traceId?: string | null;
    type?: SSEFinishType;
    usage?: ModelUsage;
  },
) => Promise<void>;

export interface MessageUsageChunk {
  type: 'usage';
  usage: ModelUsage;
}

export interface MessageSpeedChunk {
  speed: ModelPerformance;
  type: 'speed';
}

export interface MessageTextChunk {
  text: string;
  type: 'text';
}
export interface MessageStopChunk {
  reason: string;
  type: 'stop';
}

export interface MessageBase64ImageChunk {
  id: string;
  image: ChatImageChunk;
  images: ChatImageChunk[];
  type: 'base64_image';
}

export interface MessageReasoningChunk {
  signature?: string;
  text?: string;
  type: 'reasoning';
}

export interface MessageGroundingChunk {
  grounding: GroundingSearch;
  type: 'grounding';
}

export interface MessageReasoningPartChunk {
  content: string;
  mimeType?: string;
  partType: 'text' | 'image';
  thoughtSignature?: string;
  type: 'reasoning_part';
}

export interface MessageContentPartChunk {
  content: string;
  mimeType?: string;
  partType: 'text' | 'image';
  thoughtSignature?: string;
  type: 'content_part';
}

interface MessageToolCallsChunk {
  isAnimationActives?: boolean[];
  tool_calls: MessageToolCall[];
  type: 'tool_calls';
}

export interface FetchSSEOptions {
  fetcher?: typeof fetch;
  onAbort?: (text: string) => Promise<void>;
  onErrorHandle?: (error: ChatMessageError) => void;
  onFinish?: OnFinishHandler;
  onMessageHandle?: (
    chunk:
      | MessageTextChunk
      | MessageToolCallsChunk
      | MessageReasoningChunk
      | MessageReasoningPartChunk
      | MessageContentPartChunk
      | MessageGroundingChunk
      | MessageUsageChunk
      | MessageBase64ImageChunk
      | MessageSpeedChunk
      | MessageStopChunk,
  ) => void;
  responseAnimation?: ResponseAnimation;
}

const START_ANIMATION_SPEED = 10; // Default starting speed

const createSmoothMessage = (params: {
  onTextUpdate: (delta: string, text: string) => void;
  startSpeed?: number;
}) => {
  const { startSpeed = START_ANIMATION_SPEED } = params;

  let buffer = '';
  const outputQueue: string[] = [];
  let isAnimationActive = false;
  let animationFrameId: number | null = null;
  let lastFrameTime = 0;
  let accumulatedTime = 0;
  let currentSpeed = startSpeed;
  let lastQueueLength = 0; // Record the queue length from the previous frame

  const stopAnimation = () => {
    isAnimationActive = false;
    if (animationFrameId !== null) {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
    }
  };

  const startAnimation = (speed = startSpeed) => {
    return new Promise<void>((resolve) => {
      if (isAnimationActive) {
        resolve();
        return;
      }

      isAnimationActive = true;
      lastFrameTime = performance.now();
      accumulatedTime = 0;
      currentSpeed = speed;
      lastQueueLength = 0; // Reset previous frame queue length

      const updateText = (timestamp: number) => {
        if (!isAnimationActive) {
          if (animationFrameId !== null) {
            cancelAnimationFrame(animationFrameId);
          }
          resolve();
          return;
        }

        const frameDuration = timestamp - lastFrameTime;
        lastFrameTime = timestamp;
        accumulatedTime += frameDuration;

        let charsToProcess = 0;
        if (outputQueue.length > 0) {
          // Smoother speed adjustment
          const targetSpeed = Math.max(speed, outputQueue.length);
          // Adjust speed change rate based on queue length changes
          const speedChangeRate = Math.abs(outputQueue.length - lastQueueLength) * 0.0008 + 0.005;
          currentSpeed += (targetSpeed - currentSpeed) * speedChangeRate;

          charsToProcess = Math.floor((accumulatedTime * currentSpeed) / 1000);
        }

        if (charsToProcess > 0) {
          accumulatedTime -= (charsToProcess * 1000) / currentSpeed;

          const actualChars = Math.min(charsToProcess, outputQueue.length);
          // actualChars = Math.min(speed, actualChars); // Speed upper limit

          // if (actualChars * 2 < outputQueue.length && /[\dA-Za-z]/.test(outputQueue[actualChars])) {
          //   actualChars *= 2;
          // }

          const charsToAdd = outputQueue.splice(0, actualChars).join('');
          buffer += charsToAdd;
          params.onTextUpdate(charsToAdd, buffer);
        }

        lastQueueLength = outputQueue.length; // Update previous frame queue length

        if (outputQueue.length > 0 && isAnimationActive) {
          animationFrameId = requestAnimationFrame(updateText);
        } else {
          isAnimationActive = false;
          animationFrameId = null;
          resolve();
        }
      };

      animationFrameId = requestAnimationFrame(updateText);
    });
  };

  const pushToQueue = (text: string) => {
    outputQueue.push(...text.split(''));
  };

  return {
    isAnimationActive,
    isTokenRemain: () => outputQueue.length > 0,
    pushToQueue,
    startAnimation,
    stopAnimation,
  };
};

export const standardizeAnimationStyle = (
  animationStyle?: ResponseAnimation,
): Exclude<ResponseAnimation, ResponseAnimationStyle> => {
  return typeof animationStyle === 'object' ? animationStyle : { text: animationStyle };
};

/**
 * Fetch data using stream method
 */

export const fetchSSE = async (url: string, options: RequestInit & FetchSSEOptions = {}) => {
  let toolCalls: undefined | MessageToolCall[];
  let triggerOnMessageHandler = false;

  let finishedType: SSEFinishType = 'done';
  let receivedTerminalEvent = false;
  let response!: Response;

  const { text, speed: smoothingSpeed } = standardizeAnimationStyle(
    options.responseAnimation ?? {},
  );
  const shouldSkipTextProcessing = text === 'none';
  const textSmoothing = text === 'smooth';

  // Add text buffer and timer related variables
  let textBuffer = '';
  let bufferTimer: ReturnType<typeof setTimeout> | null = null;
  const BUFFER_INTERVAL = 300; // 300ms

  const flushTextBuffer = () => {
    if (textBuffer) {
      options.onMessageHandle?.({ text: textBuffer, type: 'text' });
      textBuffer = '';
    }
  };

  let output = '';
  const textController = createSmoothMessage({
    onTextUpdate: (delta, text) => {
      output = text;
      options.onMessageHandle?.({ text: delta, type: 'text' });
    },
    startSpeed: smoothingSpeed,
  });

  let thinking = '';
  let thinkingSignature: string | undefined;

  const thinkingController = createSmoothMessage({
    onTextUpdate: (delta, text) => {
      thinking = text;
      options.onMessageHandle?.({ text: delta, type: 'reasoning' });
    },
    startSpeed: smoothingSpeed,
  });

  let thinkingBuffer = '';
  let thinkingBufferTimer: ReturnType<typeof setTimeout> | null = null;

  // Create a function to handle buffer flushing
  const flushThinkingBuffer = () => {
    if (thinkingBuffer) {
      options.onMessageHandle?.({ text: thinkingBuffer, type: 'reasoning' });
      thinkingBuffer = '';
    }
  };

  let grounding: GroundingSearch | undefined = undefined;
  let usage: ModelUsage | undefined = undefined;
  const images: ChatImageChunk[] = [];
  let speed: ModelPerformance | undefined = undefined;

  // Network-error retry state. The underlying `fetchEventSource` in this repo
  // is a simplified copy that does NOT retry on its own, so we loop here.
  // Retries only happen when:
  //   - the error is a network-layer TypeError (no HTTP response received), AND
  //   - we haven't yet received any SSE message (otherwise partial output would be lost).
  let networkRetryCount = 0;
  // Set by onerror to a backoff delay when a retriable network error occurs;
  // reset to null at the top of every attempt.
  let retryAfterMs: number | null;
  let isRetry = false;

  // Retry loop: exits via `break` once an attempt finishes without scheduling a
  // retry (see the retry/abort handling after fetchEventSource below).
  while (true) {
    // On a retry attempt, reset per-attempt flags back to their initial state
    // (we keep accumulated output/toolCalls — they're empty on network failures
    // anyway since onmessage never fired). The first attempt uses the initial
    // values from the declarations above, so we skip the reset to avoid
    // redundant assignments.
    if (isRetry) {
      triggerOnMessageHandler = false;
      finishedType = 'done';
      receivedTerminalEvent = false;
    }
    retryAfterMs = null;

    await fetchEventSource(url, {
      body: options.body,
      fetch: options?.fetcher,
      headers: options.headers as Record<string, string>,
      method: options.method,
      onerror: (error) => {
        // 1. User-initiated abort — do not retry.
        if (error === MESSAGE_CANCEL_FLAT || (error as TypeError).name === 'AbortError') {
          finishedType = 'abort';
          options?.onAbort?.(output);
          textController.stopAnimation();
          return;
        }

        // 2. Business error (carries .type from upstream) — pass through, do not retry.
        if (error?.type) {
          finishedType = 'error';
          options.onErrorHandle?.(error);
          return;
        }

        // 3. Network-layer failure (fetch itself failed, no HTTP response received).
        //    Retry with exponential backoff if we haven't received any message yet.
        if (isNetworkError(error) && !triggerOnMessageHandler) {
          if (networkRetryCount < MAX_NETWORK_RETRY) {
            networkRetryCount++;
            const delay = Math.min(
              BASE_RETRY_DELAY_MS * 2 ** (networkRetryCount - 1),
              MAX_RETRY_DELAY_MS,
            );
            console.warn(
              `[fetchSSE] Network error (${error.message}), retry ${networkRetryCount}/${MAX_NETWORK_RETRY} in ${delay}ms`,
            );
            retryAfterMs = delay;
            return; // fetchEventSource will resolve; outer loop will retry.
          }
          // Exhausted retries — surface a refined NetworkError to the user.
          finishedType = 'error';
          options.onErrorHandle?.({
            body: {
              message: error.message,
              name: error.name,
              retryCount: networkRetryCount,
              stack: error.stack,
            },
            message: error.message,
            type: ChatErrorType.NetworkError,
          });
          return;
        }

        // 4. Streaming was underway then the connection dropped.
        if (triggerOnMessageHandler) {
          finishedType = 'error';
          options.onErrorHandle?.({
            body: {
              message: error?.message,
              name: error?.name,
              stack: error?.stack,
            },
            message: 'Connection aborted during streaming',
            type: ChatErrorType.ConnectionAborted,
          });
          return;
        }

        // 5. True fallback — unknown error pattern.
        finishedType = 'error';
        options.onErrorHandle?.({
          body: {
            message: error?.message,
            name: error?.name,
            stack: error?.stack,
          },
          message: error?.message || 'Unknown chat fetch error',
          type: ChatErrorType.UnknownChatFetchError,
        });
      },
      onmessage: (ev) => {
        triggerOnMessageHandler = true;
        let data;
        try {
          data = JSON.parse(ev.data);
        } catch (e) {
          console.warn('parse error:', e);
          options.onErrorHandle?.({
            body: {
              context: {
                chunk: ev.data,
                error: { message: (e as Error).message, name: (e as Error).name },
              },
              message:
                'chat response streaming chunk parse error, please contact your API Provider to fix it.',
            },
            message: 'parse error',
            type: 'StreamChunkError',
          });

          return;
        }

        switch (ev.event) {
          case 'error': {
            receivedTerminalEvent = true;
            finishedType = 'error';
            options.onErrorHandle?.(data);
            break;
          }

          case 'base64_image': {
            const id = 'tmp_img_' + nanoid();
            const item = { data, id, isBase64: true };
            images.push(item);

            options.onMessageHandle?.({ id, image: item, images, type: 'base64_image' });
            break;
          }

          case 'text': {
            // skip empty text
            if (!data) break;

            if (shouldSkipTextProcessing) {
              output += data;
              options.onMessageHandle?.({ text: data, type: 'text' });
            } else if (textSmoothing) {
              textController.pushToQueue(data);

              if (!textController.isAnimationActive) textController.startAnimation();
            } else {
              output += data;

              // Use buffer mechanism
              textBuffer += data;

              // If timer not set yet, create one
              if (!bufferTimer) {
                bufferTimer = setTimeout(() => {
                  flushTextBuffer();
                  bufferTimer = null;
                }, BUFFER_INTERVAL);
              }
            }

            break;
          }

          case 'usage': {
            receivedTerminalEvent = true;
            usage = data;
            options.onMessageHandle?.({ type: 'usage', usage: data });
            break;
          }

          case 'speed': {
            speed = data;
            options.onMessageHandle?.({ speed: data, type: 'speed' });
            break;
          }

          case 'grounding': {
            grounding = data;
            options.onMessageHandle?.({ grounding: data, type: 'grounding' });
            break;
          }

          case 'reasoning_signature': {
            thinkingSignature = data;
            break;
          }

          case 'stop': {
            receivedTerminalEvent = true;
            options.onMessageHandle?.({ reason: data, type: 'stop' });
            break;
          }

          case 'reasoning': {
            if (textSmoothing) {
              thinkingController.pushToQueue(data);

              if (!thinkingController.isAnimationActive) thinkingController.startAnimation();
            } else {
              thinking += data;

              // Use buffer mechanism
              thinkingBuffer += data;

              // If timer not set yet, create one
              if (!thinkingBufferTimer) {
                thinkingBufferTimer = setTimeout(() => {
                  flushThinkingBuffer();
                  thinkingBufferTimer = null;
                }, BUFFER_INTERVAL);
              }
            }

            break;
          }

          case 'reasoning_part': {
            // For reasoning_part, accumulate thinking content
            if (data.partType === 'text' && data.content) {
              thinking += data.content;
            }
            options.onMessageHandle?.({
              content: data.content,
              mimeType: data.mimeType,
              partType: data.partType,
              thoughtSignature: data.thoughtSignature,
              type: ev.event,
            });
            break;
          }

          case 'content_part': {
            // For content_part, accumulate text content to output
            // This is critical for Gemini 2.5 models which use content_part instead of text events
            if (data.partType === 'text' && data.content) {
              output += data.content;
            }
            options.onMessageHandle?.({
              content: data.content,
              mimeType: data.mimeType,
              partType: data.partType,
              thoughtSignature: data.thoughtSignature,
              type: ev.event,
            });
            break;
          }

          case 'tool_calls': {
            // get finial
            // if there is no tool calls, we should initialize the tool calls
            if (!toolCalls) toolCalls = [];
            toolCalls = parseToolCalls(toolCalls, data);
            options.onMessageHandle?.({ tool_calls: toolCalls, type: 'tool_calls' });
          }
        }
      },
      onopen: async (res) => {
        response = res.clone();
        // If not ok, it means there is a request error
        if (!response.ok) {
          throw await getMessageError(res);
        }
      },
      signal: options.signal,
    });

    // Retry path: onerror marked a network error and left a delay.
    // Wait, then re-enter the loop for another attempt. The wait is abort-aware:
    // if the user cancels during backoff, we resolve early and stop retrying
    // instead of sleeping the full delay and firing a doomed request.
    if (retryAfterMs !== null) {
      const delay = retryAfterMs;
      const aborted = await new Promise<boolean>((resolve) => {
        const signal = options.signal;
        if (signal?.aborted) {
          resolve(true);
          return;
        }
        const timer = setTimeout(() => {
          signal?.removeEventListener('abort', onAbort);
          resolve(false);
        }, delay);
        const onAbort = () => {
          clearTimeout(timer);
          resolve(true);
        };
        signal?.addEventListener('abort', onAbort, { once: true });
      });

      if (aborted) {
        finishedType = 'abort';
        options?.onAbort?.(output);
        textController.stopAnimation();
        break;
      }
      isRetry = true;
      continue;
    }
    break;
  }

  // only call onFinish when response is available
  // so like abort, we don't need to call onFinish
  if (response) {
    textController.stopAnimation();

    // Ensure all buffered data is processed
    if (bufferTimer) {
      clearTimeout(bufferTimer);
      flushTextBuffer();
    }

    if (thinkingBufferTimer) {
      clearTimeout(thinkingBufferTimer);
      flushThinkingBuffer();
    }

    if (response.ok) {
      // if there is no onMessageHandler, we should call onHandleMessage first
      if (!triggerOnMessageHandler) {
        output = await response.clone().text();
        options.onMessageHandle?.({ text: output, type: 'text' });
      }

      const traceId = response.headers.get(LOBE_CHAT_TRACE_ID);
      const observationId = response.headers.get(LOBE_CHAT_OBSERVATION_ID);

      if (textController.isTokenRemain()) {
        await textController.startAnimation(smoothingSpeed);
      }

      const hasStreamedContent =
        output.length > 0 || thinking.length > 0 || (toolCalls?.length ?? 0) > 0;

      if (
        finishedType === 'done' &&
        !receivedTerminalEvent &&
        triggerOnMessageHandler &&
        hasStreamedContent
      ) {
        finishedType = 'incomplete';
      }

      await options?.onFinish?.(output, {
        grounding,
        images: images.length > 0 ? images : undefined,
        observationId,
        reasoning: !!thinking ? { content: thinking, signature: thinkingSignature } : undefined,
        speed,
        toolCalls,
        traceId,
        type: finishedType,
        usage,
      });
    }
  }

  return response;
};
