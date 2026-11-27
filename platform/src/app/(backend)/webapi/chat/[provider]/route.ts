import { triplog } from '@ctrip/vampire-core';
import { type ChatCompletionErrorPayload, type ModelRuntime } from '@lobechat/model-runtime';
import { AGENT_RUNTIME_ERROR_SET } from '@lobechat/model-runtime';
import { ChatErrorType } from '@lobechat/types';

import { checkAuth } from '@/app/(backend)/middleware/auth';
import { createTraceOptions, initModelRuntimeFromDB } from '@/server/modules/ModelRuntime';
import { resolveCredentialSourceForChat } from '@/server/services/serviceModel/resolveCredentialForChat';
import { type ChatStreamPayload } from '@/types/openai/chat';
import { createErrorResponse } from '@/utils/errorResponse';
import { getTracePayload } from '@/utils/trace';

// If user don't use fluid compute, will build  failed
// this enforce user to enable fluid compute
export const maxDuration = 300;

/**
 * SSE heartbeat idle threshold in ms. If no upstream chunk flows for this long,
 * a heartbeat frame is sent to keep gateways (nginx / SLB / aigw) from cutting
 * idle connections during long reasoning or tool execution phases.
 */
const SSE_HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Heartbeat sent as a real SSE *data* frame (not a `:`-comment): this repo's
 * simplified SSE parser (`packages/utils/.../fetchEventSource/parse.ts`) does
 * not skip comment lines correctly — it would dispatch an empty message and the
 * client's `JSON.parse('')` would throw. A `data:` frame with an unknown event
 * type is silently ignored by the client's `onmessage` switch (no matching
 * case), matching the existing heartbeat in `api/agent/stream/route.ts`.
 */
const HEARTBEAT_FRAME = `event: heartbeat\ndata: {"type":"heartbeat"}\n\n`;

/**
 * Wraps an upstream streaming Response with an *idle-only* SSE heartbeat so that
 * gaps between upstream chunks don't trigger gateway idle-timeouts (which
 * manifest as "Failed to fetch" / "network error" on the client). The heartbeat
 * timer is reset on every upstream chunk, so a heartbeat is only ever emitted
 * between frames — never injected into the middle of an in-flight `data:` frame.
 * No-op for non-streaming responses.
 */
function withSSEHeartbeat(response: Response): Response {
  // Guard: non-Response objects (e.g. plain objects returned from mocked runtimes
  // in tests) should pass through untouched.
  if (!(response instanceof Response)) return response;

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream') || !response.body) {
    return response;
  }

  const upstream = response.body;
  let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  let downstreamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const heartbeatBytes = encoder.encode(HEARTBEAT_FRAME);

  const stopHeartbeat = () => {
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = null;
    }
  };

  // (Re)arm the idle timer. Called once at start and again after every upstream
  // chunk, so the heartbeat only fires when the upstream has gone quiet.
  const armHeartbeat = () => {
    stopHeartbeat();
    heartbeatTimer = setTimeout(() => {
      try {
        downstreamController?.enqueue(heartbeatBytes);
        // Keep arming while idle continues.
        armHeartbeat();
      } catch {
        // Controller closed — stop emitting.
        stopHeartbeat();
      }
    }, SSE_HEARTBEAT_INTERVAL_MS);
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      downstreamController = controller;
      armHeartbeat();

      try {
        const reader = upstream.getReader();
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            // Real data flowing — reset the idle timer so the heartbeat never
            // lands in the middle of a frame.
            armHeartbeat();
            controller.enqueue(value);
          }
        } finally {
          reader.releaseLock();
        }
      } catch (err) {
        controller.error(err);
      } finally {
        stopHeartbeat();
        try {
          controller.close();
        } catch {
          // already closed
        }
        downstreamController = null;
      }
    },
    cancel() {
      stopHeartbeat();
      downstreamController = null;
      // Best-effort cancel of upstream
      upstream.cancel().catch(() => {});
    },
  });

  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export const POST = checkAuth(
  async (req: Request, { params, userId, serverDB, createRuntime, jwtPayload }) => {
    const provider = (await params)!.provider!;

    triplog.setTraceContext('uid', userId);
    triplog.setTraceContext('provider', provider);

    try {
      const tracePayload = getTracePayload(req);

      // ============  1. init chat model   ============ //
      let modelRuntime: ModelRuntime;
      if (createRuntime) {
        // Legacy support for custom runtime creation
        modelRuntime = createRuntime(jwtPayload);
      } else {
        const credentialSource = resolveCredentialSourceForChat(provider, tracePayload);

        modelRuntime = await initModelRuntimeFromDB(serverDB, userId, provider, {
          credentialSource,
        });
      }

      // ============  2. create chat completion   ============ //

      const data = (await req.json()) as ChatStreamPayload;

      let traceOptions = {};
      // If user enable trace
      if (tracePayload?.enabled) {
        traceOptions = createTraceOptions(data, { provider, trace: tracePayload });
      }

      const result = await modelRuntime.chat(data, {
        user: userId,
        ...traceOptions,
        signal: req.signal,
      });
      const { messages: _messages, tools: _tools, ...dataWithoutMessagesAndTools } = data;

      triplog.custom({
        type: 'info',
        title: 'webapi-chat',
        message: `webapi chat data: ${JSON.stringify(dataWithoutMessagesAndTools)}\n result: ${JSON.stringify(result)}`,
      });

      return withSSEHeartbeat(result);
    } catch (e) {
      const {
        errorType = ChatErrorType.InternalServerError,
        error: errorContent,
        ...res
      } = e as ChatCompletionErrorPayload;

      const error = errorContent || e;

      const logMethod = AGENT_RUNTIME_ERROR_SET.has(errorType as string) ? 'warn' : 'error';
      // track the error at server side
      // eslint-disable-next-line no-console
      console[logMethod](`Route: [${provider}] ${errorType}:`, error);

      triplog.custom({
        type: 'error',
        title: 'webapi-chat',
        message: `webapi chat error: ${JSON.stringify(error)}, errorType: ${errorType}`,
      });

      // Sanitize native Errors before serializing: a raw `Error`'s `message`/`stack`
      // are non-enumerable, so `JSON.stringify(new Error(...))` yields `"{}"` and the
      // client sees an empty error body. Mirror `models/[provider]/route.ts` and
      // extract `message`/`name`. Structured payloads (objects) pass through as-is.
      const sanitizedError =
        error instanceof Error ? { message: error.message, name: error.name } : error;

      return createErrorResponse(errorType, { error: sanitizedError, ...res, provider });
    }
  },
);
