import { type AgentState } from '@lobechat/agent-runtime';
import debug from 'debug';

import { type AgentOperationMetadata, type StepResult } from './AgentStateManager';
import { type IAgentStateManager } from './types';

const log = debug('lobe-server:agent-runtime:in-memory-state-manager');

/**
 * In-Memory Agent State Manager
 * In-memory implementation for testing and local development environments
 */
export class InMemoryAgentStateManager implements IAgentStateManager {
  private states: Map<string, AgentState> = new Map();
  private steps: Map<string, any[]> = new Map();
  private metadata: Map<string, AgentOperationMetadata> = new Map();
  private events: Map<string, any[][]> = new Map();

  async saveAgentState(operationId: string, state: AgentState): Promise<void> {
    // Deep clone to avoid reference issues
    this.states.set(operationId, structuredClone(state));

    // Update metadata
    const existingMeta = this.metadata.get(operationId);
    if (existingMeta) {
      existingMeta.lastActiveAt = new Date().toISOString();
      existingMeta.status = state.status;
      existingMeta.totalCost = state.cost?.total || 0;
      existingMeta.totalSteps = state.stepCount;
    }

    log('[%s] Saved state for step %d', operationId, state.stepCount);
  }

  async loadAgentState(operationId: string): Promise<AgentState | null> {
    const state = this.states.get(operationId);
    if (!state) {
      return null;
    }

    log('[%s] Loaded state (step %d)', operationId, state.stepCount);
    // Return deep clone to prevent external modifications from affecting internal state
    return structuredClone(state);
  }

  async saveStepResult(operationId: string, stepResult: StepResult): Promise<void> {
    // Save latest state
    // Use JSON round-trip instead of structuredClone to safely handle
    // non-cloneable objects (e.g. DOM ErrorEvent from Neon DB errors)
    this.states.set(operationId, JSON.parse(JSON.stringify(stepResult.newState)));

    // Save step history
    let stepHistory = this.steps.get(operationId);
    if (!stepHistory) {
      stepHistory = [];
      this.steps.set(operationId, stepHistory);
    }

    const stepData = {
      context: stepResult.nextContext,
      cost: stepResult.newState.cost?.total || 0,
      executionTime: stepResult.executionTime,
      status: stepResult.newState.status,
      stepIndex: stepResult.stepIndex,
      timestamp: Date.now(),
    };

    // Insert at beginning (newest first)
    stepHistory.unshift(stepData);
    // Keep most recent 200 steps
    if (stepHistory.length > 200) {
      stepHistory.length = 200;
    }

    // Save step event sequence
    if (stepResult.events && stepResult.events.length > 0) {
      let eventHistory = this.events.get(operationId);
      if (!eventHistory) {
        eventHistory = [];
        this.events.set(operationId, eventHistory);
      }
      eventHistory.unshift(stepResult.events);
      if (eventHistory.length > 200) {
        eventHistory.length = 200;
      }
    }

    // Update operation metadata
    const existingMeta = this.metadata.get(operationId);
    if (existingMeta) {
      existingMeta.lastActiveAt = new Date().toISOString();
      existingMeta.status = stepResult.newState.status;
      existingMeta.totalCost = stepResult.newState.cost?.total || 0;
      existingMeta.totalSteps = stepResult.newState.stepCount;
    }

    log(
      '[%s:%d] Saved step result with %d events',
      operationId,
      stepResult.stepIndex,
      stepResult.events?.length || 0,
    );
  }

  async getExecutionHistory(operationId: string, limit: number = 50): Promise<any[]> {
    const history = this.steps.get(operationId);
    if (!history) {
      return [];
    }

    // Return reversed array (earliest first)
    return history.slice(0, limit).reverse();
  }

  async getOperationMetadata(operationId: string): Promise<AgentOperationMetadata | null> {
    return this.metadata.get(operationId) ?? null;
  }

  async createOperationMetadata(
    operationId: string,
    data: {
      agentConfig?: any;
      modelRuntimeConfig?: any;
      userId?: string;
    },
  ): Promise<void> {
    const metadata: AgentOperationMetadata = {
      agentConfig: data.agentConfig,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      modelRuntimeConfig: data.modelRuntimeConfig,
      status: 'idle',
      totalCost: 0,
      totalSteps: 0,
      userId: data.userId,
    };

    this.metadata.set(operationId, metadata);
    log('[%s] Created operation metadata', operationId);
  }

  async deleteAgentOperation(operationId: string): Promise<void> {
    this.states.delete(operationId);
    this.steps.delete(operationId);
    this.metadata.delete(operationId);
    this.events.delete(operationId);
    log('Deleted operation %s', operationId);
  }

  async getActiveOperations(): Promise<string[]> {
    return Array.from(this.states.keys());
  }

  async cleanupExpiredOperations(): Promise<number> {
    const activeOperations = await this.getActiveOperations();
    let cleanedCount = 0;

    for (const operationId of activeOperations) {
      const metadata = this.metadata.get(operationId);

      if (metadata) {
        const lastActiveTime = new Date(metadata.lastActiveAt).getTime();
        const now = Date.now();
        const hoursSinceActive = (now - lastActiveTime) / (1000 * 60 * 60);

        // Clean up operations inactive for more than 1 hour
        if (hoursSinceActive > 1) {
          await this.deleteAgentOperation(operationId);
          cleanedCount++;
        }
      }
    }

    log('Cleaned up %d expired operations', cleanedCount);
    return cleanedCount;
  }

  async getStats(): Promise<{
    activeOperations: number;
    completedOperations: number;
    errorOperations: number;
    totalOperations: number;
  }> {
    const operations = await this.getActiveOperations();
    const stats = {
      activeOperations: 0,
      completedOperations: 0,
      errorOperations: 0,
      totalOperations: operations.length,
    };

    for (const operationId of operations) {
      const metadata = this.metadata.get(operationId);

      if (metadata) {
        switch (metadata.status) {
          case 'running':
          case 'waiting_for_human': {
            stats.activeOperations++;
            break;
          }
          case 'done': {
            stats.completedOperations++;
            break;
          }
          case 'error':
          case 'interrupted': {
            stats.errorOperations++;
            break;
          }
        }
      }
    }

    return stats;
  }

  /**
   * ⚠️ 空实现：无条件放行，既不记录也不校验。
   *
   * 非 queue 模式下 `createAgentStateManager()` 无条件返回本类（factory.ts:32），
   * 所以此时**同一 `(operationId, stepIndex)` 可以被并发执行多次**，
   * `AgentRuntimeService` 那套 429 + `Retry-After: 37` 的防重入完全走不到。
   * 单进程 `LocalQueueServiceImpl` 下风险较低，但 webhook 重投、手动 `startExecution`、
   * 并发 `processHumanIntervention` 都可能触发重复执行。
   * 要真正的步锁，必须开 `AGENT_RUNTIME_MODE=queue` 走 Redis 版。
   */
  async tryClaimStep(
    _operationId: string,
    _stepIndex: number,
    _ttlSeconds?: number,
  ): Promise<boolean> {
    return true;
  }

  async releaseStepLock(_operationId: string, _stepIndex: number): Promise<void> {
    // noop
  }

  // ==================== 中断标记 ====================
  // 与 Redis 版语义一致：独立于 state 存放，不会被步骤保存覆盖。
  // 内存态是单进程的，用 Set 即可。

  private interrupted = new Set<string>();

  async markInterrupted(operationId: string, _ttlSeconds?: number): Promise<void> {
    this.interrupted.add(operationId);
    log('[%s] Interrupt flag set (in-memory)', operationId);
  }

  async isInterrupted(operationId: string): Promise<boolean> {
    return this.interrupted.has(operationId);
  }

  async clearInterrupt(operationId: string): Promise<void> {
    this.interrupted.delete(operationId);
  }

  async disconnect(): Promise<void> {
    // In-memory implementation doesn't need to disconnect
    log('InMemoryAgentStateManager disconnected');
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    this.states.clear();
    this.steps.clear();
    this.metadata.clear();
    this.events.clear();
    log('All data cleared');
  }

  /**
   * Get event history (for test verification)
   */
  getEventHistory(operationId: string): any[][] {
    return this.events.get(operationId) ?? [];
  }
}

/**
 * Singleton instance for testing and local development environments
 */
export const inMemoryAgentStateManager = new InMemoryAgentStateManager();
