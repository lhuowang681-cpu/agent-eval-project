import { type AgentState } from '@lobechat/agent-runtime';

import { type AgentOperationMetadata, type StepResult } from './AgentStateManager';
import { type StreamChunkData, type StreamEvent } from './StreamEventManager';

/**
 * Agent State Manager Interface
 * Abstract interface for state persistence, supports Redis and in-memory implementations
 */
export interface IAgentStateManager {
  /**
   * Clean up expired operation data
   */
  cleanupExpiredOperations: () => Promise<number>;

  /**
   * Create new operation metadata
   */
  createOperationMetadata: (
    operationId: string,
    data: {
      agentConfig?: any;
      modelRuntimeConfig?: any;
      userId?: string;
    },
  ) => Promise<void>;

  /**
   * Delete all data for Agent operation
   */
  deleteAgentOperation: (operationId: string) => Promise<void>;

  /**
   * Close connections
   */
  disconnect: () => Promise<void>;

  /**
   * Get all active operations
   */
  getActiveOperations: () => Promise<string[]>;

  /**
   * Get execution history
   */
  getExecutionHistory: (operationId: string, limit?: number) => Promise<any[]>;

  /**
   * Get operation metadata
   */
  getOperationMetadata: (operationId: string) => Promise<AgentOperationMetadata | null>;

  /**
   * Get statistics
   */
  getStats: () => Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }>;

  /**
   * Load Agent state
   */
  loadAgentState: (operationId: string) => Promise<AgentState | null>;

  /**
   * Release the step execution lock.
   */
  releaseStepLock: (operationId: string, stepIndex: number) => Promise<void>;

  /**
   * Save Agent state
   */
  saveAgentState: (operationId: string, state: AgentState) => Promise<void>;

  /**
   * Save step execution result
   */
  saveStepResult: (operationId: string, stepResult: StepResult) => Promise<void>;

  /**
   * Atomically try to claim a step for execution (distributed lock).
   * Returns true if the lock was acquired, false if another execution already holds it.
   */
  tryClaimStep: (operationId: string, stepIndex: number, ttlSeconds?: number) => Promise<boolean>;

  // ==================== 中断标记 ====================
  //
  // 为什么中断不能只写在 AgentState 里：
  // `executeStep` 在步骤开始时把 state 读进内存，结束时用**自己那份**覆盖写回。
  // 中断若发生在「读」与「写」之间，就会被这次覆盖冲掉 —— 典型的丢失更新。
  // 实测中 agent 以约 6 步/秒推进，这个窗口频繁命中，表现为
  // `interruptTask` 返回成功、步数却继续增长（附录 B-2）。
  //
  // 因此中断标记独立于 state 存放：它只被 set / read / clear，
  // 不参与步骤状态的整体覆盖，也天然跨进程可见（queue 模式下每步是独立 HTTP 请求）。

  /**
   * 清除中断标记（operation 进入终态或重新发起时调用）。
   */
  clearInterrupt: (operationId: string) => Promise<void>;

  /**
   * 读取中断标记。
   */
  isInterrupted: (operationId: string) => Promise<boolean>;

  /**
   * 打上中断标记，与 AgentState 分开存放，不会被步骤保存覆盖。
   */
  markInterrupted: (operationId: string, ttlSeconds?: number) => Promise<void>;
}

/**
 * Stream Event Manager Interface
 * Abstract interface for stream event publishing, supports Redis and in-memory implementations
 */
export interface IStreamEventManager {
  /**
   * Clean up stream data for operation
   */
  cleanupOperation: (operationId: string) => Promise<void>;

  /**
   * Close connections
   */
  disconnect: () => Promise<void>;

  /**
   * Get count of active operations
   */
  getActiveOperationsCount: () => Promise<number>;

  /**
   * Get stream event history
   */
  getStreamHistory: (operationId: string, count?: number) => Promise<StreamEvent[]>;

  /**
   * Publish Agent runtime end event
   */
  publishAgentRuntimeEnd: (
    operationId: string,
    stepIndex: number,
    finalState: any,
    reason?: string,
    reasonDetail?: string,
  ) => Promise<string>;

  /**
   * Publish Agent runtime initialization event
   */
  publishAgentRuntimeInit: (operationId: string, initialState: any) => Promise<string>;

  /**
   * Publish stream content chunk
   */
  publishStreamChunk: (
    operationId: string,
    stepIndex: number,
    chunkData: StreamChunkData,
  ) => Promise<string>;

  /**
   * Publish stream event
   */
  publishStreamEvent: (
    operationId: string,
    event: Omit<StreamEvent, 'operationId' | 'timestamp'>,
  ) => Promise<string>;

  /**
   * Subscribe to stream events (for SSE endpoint)
   */
  subscribeStreamEvents: (
    operationId: string,
    lastEventId: string,
    onEvents: (events: StreamEvent[]) => void,
    signal?: AbortSignal,
  ) => Promise<void>;
}
