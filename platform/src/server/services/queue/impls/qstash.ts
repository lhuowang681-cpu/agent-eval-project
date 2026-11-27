import debug from 'debug';

import { type HealthCheckResult, type QueueMessage, type QueueStats } from '../types';
import { type QueueServiceImpl } from './type';

const log = debug('lobe-server:service:queue:qstash');

/**
 * QStash queue service implementation
 */
export class QStashQueueServiceImpl implements QueueServiceImpl {
  private config: { publishUrl?: string; qstashToken: string };

  constructor(config: { publishUrl?: string; qstashToken: string }) {
    if (!config.qstashToken) {
      throw new Error('QStash token is required for queue service');
    }

    this.config = config;
  }

  async scheduleMessage(message: QueueMessage): Promise<string> {
    const {
      operationId,
      stepIndex,
      context,
      endpoint,
      payload,
      delay = 50,
      priority = 'normal',
      retries = 3,
    } = message;

    try {
      const { Client } = await import('@ctrip/qstash');
      log('Initialized QStash queue service');
      const qstashClient = new Client({ token: this.config.qstashToken });
      const response = await qstashClient.publishJSON({
        body: {
          context,
          operationId,
          // ⚠️ payload 必须**摊平到顶层**。
          // `/api/agent/run` 是这样解构请求体的：
          //   const { operationId, stepIndex, context, humanInput, approvedToolCall,
          //           rejectionReason } = body;
          // 全部取自顶层。此前这里把它们嵌在 `payload` 下投递，路由侧解构出来全是
          // undefined —— 人在环的审批结果根本到不了 executeStep，步骤按「无干预」重跑，
          // `pendingToolsCalling` 永不清除，operation 永久卡在 waiting_for_human
          // （附录 C-2；`stepIndex` 传 0 还是 stepCount 都不管用，因为数据压根没送到）。
          ...(payload ?? {}),
          // 保留原字段，便于排查与向后兼容
          payload,
          priority,
          stepIndex,
          timestamp: Date.now(),
        },
        delay: Math.ceil(delay / 1000), // Convert milliseconds to seconds
        headers: {
          'Content-Type': 'application/json',
          'X-Agent-Operation-Id': operationId,
          'X-Agent-Priority': priority,
          'X-Agent-Step-Index': stepIndex.toString(),
        },
        retries,
        url: endpoint,
      });

      log(
        `[${operationId}] Scheduled step %d to %s with %dms delay (messageId: %s)`,
        stepIndex,
        endpoint,
        delay,
        'messageId' in response ? response.messageId : 'batch-message',
      );

      return 'messageId' in response ? response.messageId : `scheduled-${Date.now()}`;
    } catch (error) {
      log('Failed to schedule step %d for operation %s: %O', stepIndex, operationId, error);
      throw error;
    }
  }

  async scheduleBatchMessages(messages: QueueMessage[]): Promise<string[]> {
    try {
      // Use Promise.all for concurrent execution
      const messageIds = await Promise.all(
        messages.map((message) => this.scheduleMessage(message)),
      );

      log('Scheduled %d batch messages', messages.length);
      return messageIds;
    } catch (error) {
      log('Failed to schedule batch messages: %O', error);
      throw error;
    }
  }

  async cancelScheduledTask(messageId: string): Promise<void> {
    try {
      // QStash currently doesn't support task cancellation, can record to Redis as cancellation marker
      // Check this marker during actual execution
      log('Requested cancellation for message %s', messageId);

      // TODO: Implement cancellation logic, cancellation list can be stored via Redis
      // await this.redis.sadd('cancelled_tasks', messageId);
    } catch (error) {
      log('Failed to cancel task %s: %O', messageId, error);
      throw error;
    }
  }

  async getQueueStats(): Promise<QueueStats> {
    return {
      completedCount: 0,
      failedCount: 0,
      pendingCount: 0,
      processingCount: 0,
    };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    // Simple health check without sending actual messages
    return {
      healthy: true,
      message: 'QStash queue service is ready',
    };
  }
}
