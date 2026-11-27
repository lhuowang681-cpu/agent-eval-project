import { triplog } from '@ctrip/vampire-core';
import { createSSEHeaders, createSSEWriter } from '@lobechat/utils/server';
import debug from 'debug';
import { type NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { resolveRouteUserId } from '@/app/(backend)/middleware/auth/resolveRouteUserId';
import { createStreamEventManager } from '@/server/modules/AgentRuntime';

const log = debug('api-route:agent:stream');
const timing = debug('lobe-server:agent-runtime:timing');

/**
 * Server-Sent Events (SSE) endpoint
 * Provides real-time Agent execution event stream for clients
 */
export async function GET(request: NextRequest) {
  /*
   * 认证闸门（L1）。
   *
   * 此前本路由**零鉴权** —— 知道 operationId 就能订阅该次运行的完整事件流，
   * 而流里是完整 LLM 正文与工具调用参数。同一应用内其它端点（tRPC lambda、
   * /api/v1）全都要求凭证，唯独这里不要，属一致性缺口。
   *
   * 代价接近零：所有合法调用方本来就带着凭证 —— Web/移动端同源 fetch 自动带 cookie，
   * 桌面端经 `RemoteServerSyncCtr` 明确附 `Oidc-Auth`，测试带开发态旁路头。
   * 客户端用的是自研 `fetchEventSource`（基于 fetch，能带头与 cookie），
   * 不是原生 EventSource，因此**前端无需改动**。
   *
   * ⚠️ 这里**只做认证，不校验 operation 归属** —— 是按内部效能 agent、内网部署的
   * 背景做出的取舍：归属校验要在每次连接多打一次 `getOperationMetadata`，
   * 而它防的是「已登录同事拿到 operationId 读你的流」，在该背景下代价换收益不划算。
   * 若将来对话可能含并非所有员工都可见的数据，应补上归属校验。
   */
  const userId = await resolveRouteUserId(request);
  if (!userId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Initialize stream event manager (uses InMemory singleton in local dev, Redis in production)
  const streamManager = createStreamEventManager();

  const { searchParams } = new URL(request.url);
  const operationId = searchParams.get('operationId');
  const lastEventId = searchParams.get('lastEventId') || '0';
  const includeHistory = searchParams.get('includeHistory') === 'true';

  if (!operationId) {
    return NextResponse.json(
      {
        error: 'operationId parameter is required',
      },
      { status: 400 },
    );
  }

  log(`Starting SSE connection for operation ${operationId} from eventId ${lastEventId}`);

  triplog.custom({
    message: `SSE connection start | operationId=${operationId} lastEventId=${lastEventId}`,
    title: 'agent.stream',
    type: 'info',
  });

  // Create Server-Sent Events stream
  const stream = new ReadableStream({
    cancel(reason) {
      log(`SSE connection cancelled for operation ${operationId}:`, reason);

      // Call cleanup function
      if ((this as any)._cleanup) {
        (this as any)._cleanup();
      }
    },

    start(controller) {
      const writer = createSSEWriter(controller);

      // Send connection confirmation event
      writer.writeConnection(operationId, lastEventId);
      log(`SSE connection established for operation ${operationId}`);

      // If needed, send historical events first
      if (includeHistory) {
        streamManager
          .getStreamHistory(operationId, 50)
          .then((history) => {
            // Send historical events in chronological order (earliest first)
            const sortedHistory = history.reverse();

            sortedHistory.forEach((event) => {
              // Only send events newer than lastEventId
              if (!lastEventId || lastEventId === '0' || event.timestamp.toString() > lastEventId) {
                try {
                  // Add SSE-specific fields, keeping format consistent with real-time events
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };
                  writer.writeStreamEvent(sseEvent, operationId);
                } catch (error) {
                  console.error('[Agent Stream] Error sending history event:', error);
                }
              }
            });

            if (sortedHistory.length > 0) {
              log(`Sent ${sortedHistory.length} historical events for operation ${operationId}`);
            }
          })
          .catch((error) => {
            console.error('[Agent Stream] Failed to load history:', error);

            try {
              writer.writeError(error, operationId, 'history_loading');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send error event:', controllerError);
            }
          });
      }

      // Create AbortController for canceling subscription
      const abortController = new AbortController();

      // Track if stream has ended (agent_runtime_end received)
      // Once set to true, no more events will be sent
      let streamEnded = false;

      // Send heartbeat periodically (every 30 seconds)
      const heartbeatInterval = setInterval(() => {
        // Skip heartbeat if stream has ended
        if (streamEnded) {
          return;
        }

        try {
          const heartbeat = {
            operationId,
            timestamp: Date.now(),
            type: 'heartbeat',
          };

          controller.enqueue(`data: ${JSON.stringify(heartbeat)}\n\n`);
        } catch (error) {
          console.error('[Agent Stream] Heartbeat error:', error);
          clearInterval(heartbeatInterval);
        }
      }, 30_000);

      // Cleanup function
      const cleanup = () => {
        abortController.abort();
        clearInterval(heartbeatInterval);
        log(`SSE connection closed for operation ${operationId}`);
        triplog.custom({
          message: `SSE connection closed | operationId=${operationId}`,
          title: 'agent.stream',
          type: 'info',
        });
      };

      // Subscribe to new streaming events
      const subscribeToEvents = async () => {
        try {
          await streamManager.subscribeStreamEvents(
            operationId,
            lastEventId,
            (events) => {
              events.forEach((event) => {
                // Skip all events if stream has ended
                if (streamEnded) {
                  return;
                }

                try {
                  // Add SSE-specific fields
                  const sseEvent = {
                    ...event,
                    operationId,
                    timestamp: event.timestamp || Date.now(),
                  };

                  const now = Date.now();
                  const totalLatency = now - sseEvent.timestamp;
                  writer.writeStreamEvent(sseEvent, operationId);
                  timing(
                    '[%s:%d] SSE sent %s, original timestamp %d, sent at %d, total latency %dms',
                    operationId,
                    event.stepIndex,
                    event.type,
                    sseEvent.timestamp,
                    now,
                    totalLatency,
                  );

                  // If agent_runtime_end event is received, terminate stream immediately
                  if (event.type === 'agent_runtime_end') {
                    log(
                      `Agent runtime ended for operation ${operationId}, terminating stream immediately`,
                    );

                    // Mark stream as ended to prevent any more events
                    streamEnded = true;

                    // Immediately cleanup and close connection
                    cleanup();
                    controller.close();
                    log(
                      `SSE connection closed after agent runtime end for operation ${operationId}`,
                    );
                  }
                } catch (error) {
                  console.error('[Agent Stream] Error sending event:', error);
                }
              });
            },
            abortController.signal,
          );
        } catch (error) {
          if (!abortController.signal.aborted) {
            console.error('[Agent Stream] Subscription error:', error);

            try {
              writer.writeError(error as Error, operationId, 'stream_subscription');
            } catch (controllerError) {
              console.error('[Agent Stream] Failed to send subscription error:', controllerError);
            }
          }
        }
      };

      // Start subscription
      subscribeToEvents();

      // Listen for connection close
      request.signal?.addEventListener('abort', cleanup);

      // Store cleanup function for calling during cancel
      (controller as any)._cleanup = cleanup;
    },
  });

  // Set SSE response headers
  return new Response(stream, {
    headers: createSSEHeaders(),
  });
}
