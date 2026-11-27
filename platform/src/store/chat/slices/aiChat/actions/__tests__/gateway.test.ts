import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentRuntimeClient } from '@/services/agentRuntime';
import { messageService } from '@/services/message';

import { useChatStore } from '../../../../store';
import { messageMapKey } from '../../../../utils/messageMapKey';
import { TEST_IDS } from './fixtures';
import { resetTestEnvironment } from './helpers';

// Keep zustand mock as it's needed globally
vi.mock('zustand/traditional');

// `@lobechat/builtin-skills` statically pulls in SKILL.md docs that vite can't
// transform under vitest (baseline issue shared by every test in this dir); stub
// it so the chat-store import graph resolves.
vi.mock('@lobechat/builtin-skills', () => ({
  builtinSkills: [],
  FeishuCliIdentifier: 'feishu-cli',
  OpenCliIdentifier: 'opencli',
  TripYoYoIdentifier: 'tripyoyo',
}));

const RECONNECT_PARAMS = {
  agentId: TEST_IDS.SESSION_ID,
  assistantMessageId: TEST_IDS.ASSISTANT_MESSAGE_ID,
  operationId: 'srv_op_reconnect',
  topicId: TEST_IDS.TOPIC_ID,
};

const setGatewayUrl = (agentGatewayUrl?: string) => {
  (window as any).global_serverConfigStore = {
    getState: () => ({ serverConfig: { agentGatewayUrl } }),
  };
};

beforeEach(() => {
  resetTestEnvironment();
  setGatewayUrl('https://gateway.example.com');
  vi.spyOn(messageService, 'getMessages').mockResolvedValue([] as any);
  vi.spyOn(agentRuntimeClient, 'createStreamConnection').mockImplementation(
    () => new AbortController(),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as any).global_serverConfigStore;
});

describe('reconnectToGatewayOperation', () => {
  it('re-attaches the SSE stream with history replay and creates a local op', async () => {
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.reconnectToGatewayOperation(RECONNECT_PARAMS);
    });

    // Opens the stream keyed on the server operationId, replaying buffered events.
    expect(agentRuntimeClient.createStreamConnection).toHaveBeenCalledTimes(1);
    const [operationId, options] = (agentRuntimeClient.createStreamConnection as any).mock.calls[0];
    expect(operationId).toBe(RECONNECT_PARAMS.operationId);
    expect(options.includeHistory).toBe(true);

    // A local op exists under the SAME server operationId (drives loading state +
    // dedup + cancel routing).
    const op = result.current.operations[RECONNECT_PARAMS.operationId];
    expect(op?.type).toBe('execServerAgentRuntime');
    expect(op?.status).toBe('running');

    // Messages replaced under the key the task drawer subscribes to.
    const drawerKey = messageMapKey({
      agentId: RECONNECT_PARAMS.agentId,
      scope: 'main',
      topicId: RECONNECT_PARAMS.topicId,
    });
    expect(result.current.messagesMap[drawerKey]).toBeDefined();
  });

  it('skips reconnect when an op for the same id is already active locally', async () => {
    const { result } = renderHook(() => useChatStore());

    // Simulate this tab already owning a live op (e.g. it started the run).
    act(() => {
      result.current.startOperation({
        context: { agentId: RECONNECT_PARAMS.agentId, topicId: RECONNECT_PARAMS.topicId },
        operationId: RECONNECT_PARAMS.operationId,
        type: 'execServerAgentRuntime',
      });
    });

    await act(async () => {
      await result.current.reconnectToGatewayOperation(RECONNECT_PARAMS);
    });

    expect(agentRuntimeClient.createStreamConnection).not.toHaveBeenCalled();
  });

  it('re-attaches even when no gateway URL is configured (SSE is gateway-independent)', async () => {
    // The task SSE stream is the internal `/api/agent/stream` endpoint, available
    // regardless of gateway config — so reconnect must NOT be gated on it.
    setGatewayUrl(undefined);
    const { result } = renderHook(() => useChatStore());

    await act(async () => {
      await result.current.reconnectToGatewayOperation(RECONNECT_PARAMS);
    });

    expect(agentRuntimeClient.createStreamConnection).toHaveBeenCalledTimes(1);
    expect(result.current.operations[RECONNECT_PARAMS.operationId]?.type).toBe(
      'execServerAgentRuntime',
    );
  });
});
