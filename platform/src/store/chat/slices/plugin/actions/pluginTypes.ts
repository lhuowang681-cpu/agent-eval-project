import { isDesktop } from '@lobechat/const';
import { type ChatToolPayload, type RuntimeStepContext } from '@lobechat/types';
import { resolveToolMessageContent } from '@lobechat/utils';
import { PluginErrorType } from '@lobehub/chat-plugin-sdk';
import debug from 'debug';
import { t } from 'i18next';

import {
  reportClientMcpMarketUsage,
  reportClientSkillMarketUsage,
} from '@/helpers/reportMarketUsage';
import { getEffectiveWorkingDirectory } from '@/hooks/useEffectiveWorkingDirectory';
import { type MCPToolCallResult } from '@/libs/mcp';
import { truncateToolResult } from '@/server/utils/truncateToolResult';
import { chatService } from '@/services/chat';
import { isLarkCliAuthError, waitForFeishuCliAuth } from '@/services/electron/feishuCli';
import { FEISHU_AUTH_REQUIRED, feishuTokenService } from '@/services/feishuToken';
import { mcpService } from '@/services/mcp';
import { messageService } from '@/services/message';
import { AI_RUNTIME_OPERATION_TYPES } from '@/store/chat/slices/operation';
import { type ChatStore } from '@/store/chat/store';
import { useToolStore } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors/tool';
import { hasExecutor } from '@/store/tool/slices/builtin/executors';
import { type StoreSetter } from '@/store/types';
import { safeParseJSON } from '@/utils/safeParseJSON';

import { dbMessageSelectors } from '../../message/selectors';
import { type RemoteToolExecutor } from './exector';
import { klavisExecutor, lobehubSkillExecutor } from './exector';

const log = debug('lobe-store:plugin-types');

/**
 * Plugin type-specific implementations
 * Each method handles a specific type of plugin invocation
 */

type Setter = StoreSetter<ChatStore>;
export const pluginTypes = (set: Setter, get: () => ChatStore, _api?: unknown) =>
  new PluginTypesActionImpl(set, get, _api);

export class PluginTypesActionImpl {
  readonly #get: () => ChatStore;

  constructor(set: Setter, get: () => ChatStore, _api?: unknown) {
    void _api;
    void set;
    this.#get = get;
  }

  invokeBuiltinTool = async (
    id: string,
    payload: ChatToolPayload,
    stepContext?: RuntimeStepContext,
  ): Promise<any> => {
    // Check if this is a Klavis tool by source field
    if (payload.source === 'klavis') {
      return await this.#get().invokeKlavisTypePlugin(id, payload);
    }

    // Check if this is a TripYoYo Skill tool by source field
    if (payload.source === 'lobehubSkill') {
      return await this.#get().invokeLobehubSkillTypePlugin(id, payload);
    }

    const params = safeParseJSON(payload.arguments);
    if (!params) return { error: 'Invalid arguments', success: false };

    // Check if there's a registered executor in Tool Store (new architecture)
    if (hasExecutor(payload.identifier, payload.apiName)) {
      // Validate required params against the tool's manifest schema before dispatch.
      // Models occasionally emit empty/partial tool arguments (e.g. "{}"); without
      // this guard those reach executors and crash with confusing errors (such as
      // "Cannot read properties of undefined (reading 'slice')"), trapping the model
      // in a retry loop. Reject early with a clear, actionable message instead.
      const missingParams = toolSelectors
        .getBuiltinApiRequiredParams(payload.identifier, payload.apiName)(useToolStore.getState())
        .filter((key) => params[key] == null);
      if (missingParams.length > 0) {
        const message = `Missing required parameter(s): ${missingParams.join(', ')}`;
        return {
          content: message,
          error: { message, type: 'InvalidToolArguments' },
          success: false,
        };
      }

      const { optimisticUpdateToolMessage, registerAfterCompletionCallback } = this.#get();

      // Get operation context
      const operationId = this.#get().messageOperationMap[id];
      const operation = operationId ? this.#get().operations[operationId] : undefined;
      const context = operationId ? { operationId } : undefined;

      // Get agent ID, group ID, and topic ID from operation context
      let agentId = operation?.context?.agentId;
      let groupId = operation?.context?.groupId;
      const topicId = operation?.context?.topicId;

      // For agent-builder tools, inject activeAgentId from store if not in context
      // This is needed because AgentBuilderProvider uses a separate scope for messages
      // but the tools need the correct agentId for execution
      if (payload.identifier === 'lobe-agent-builder') {
        const activeAgentId = this.#get().activeAgentId;
        if (activeAgentId) {
          agentId = activeAgentId;
        }
      }

      // For group-agent-builder tools, inject activeGroupId from store if not in context
      // This is needed because AgentBuilderProvider uses a separate scope for messages
      // but still needs groupId for tool execution
      if (!groupId && payload.identifier === 'lobe-group-agent-builder') {
        const { getChatGroupStoreState } = await import('@/store/agentGroup');
        groupId = getChatGroupStoreState().activeGroupId;
      }

      // Get group orchestration callbacks if available (for group management tools)
      const groupOrchestration = this.#get().getGroupOrchestrationCallbacks?.();

      // Find root execAgentRuntime operation for registering afterCompletion callbacks
      // Navigate up the operation tree to find the root runtime operation
      let rootRuntimeOperationId: string | undefined;
      if (operationId) {
        let currentOp = operation;
        while (currentOp) {
          if (AI_RUNTIME_OPERATION_TYPES.includes(currentOp.type)) {
            rootRuntimeOperationId = currentOp.id;
            break;
          }
          // Move up to parent operation
          const parentId = currentOp.parentOperationId;
          currentOp = parentId ? this.#get().operations[parentId] : undefined;
        }
      }

      // Create registerAfterCompletion function that registers callback to root runtime operation
      const registerAfterCompletion = rootRuntimeOperationId
        ? (callback: Parameters<typeof registerAfterCompletionCallback>[1]) => {
            registerAfterCompletionCallback(rootRuntimeOperationId!, callback);
          }
        : undefined;

      log(
        '[invokeBuiltinTool] Using Tool Store executor: %s/%s, messageId=%s, agentId=%s, groupId=%s, hasGroupOrchestration=%s, rootRuntimeOp=%s, stepContext=%O',
        payload.identifier,
        payload.apiName,
        id,
        agentId,
        groupId,
        !!groupOrchestration,
        rootRuntimeOperationId,
        !!stepContext,
      );

      // Call Tool Store's invokeBuiltinTool
      let result = await useToolStore
        .getState()
        .invokeBuiltinTool(payload.identifier, payload.apiName, params, {
          agentId,
          groupId,
          groupOrchestration,
          messageId: id,
          operationId,
          registerAfterCompletion,
          signal: operation?.abortController?.signal,
          stepContext,
          topicId,
          workingDirectory: getEffectiveWorkingDirectory(agentId),
        });

      // Desktop gate: 检测 execScript (lark-cli) 的鉴权错误,挂起等待用户授权后重试。
      // 循环处理:若授权后重试仍是鉴权错误（例如缺的是另一个 scope）,重新挂起让用户再授权一次,
      // 而不是直接卡住（卡片还在但点了没反应）。MAX_AUTH_RETRIES 防止无限循环。
      const MAX_AUTH_RETRIES = 3;
      let authRetries = 0;
      while (isDesktop && isLarkCliAuthError(result.content) && authRetries < MAX_AUTH_RETRIES) {
        authRetries += 1;
        log(
          '[invokeBuiltinTool] Lark-cli auth error detected (attempt %d), waiting for authorization: messageId=%s, tool=%s',
          authRetries,
          id,
          payload.apiName,
        );

        // 更新 toolMessage 显示授权卡片
        await optimisticUpdateToolMessage(
          id,
          {
            content: result.content,
            pluginError: {
              message: 'Lark-cli authorization required',
              type: 'FEISHU_CLI_AUTH_REQUIRED' as any,
            },
            pluginState: result.state,
          },
          context,
        );

        // 挂起等待用户完成授权（以 messageId 为 key 隔离并发）
        try {
          await waitForFeishuCliAuth(id);
        } catch {
          log(
            '[invokeBuiltinTool] Lark-cli auth cancelled or failed: messageId=%s, tool=%s',
            id,
            payload.apiName,
          );
          return result;
        }

        // 授权完成,重新调用工具
        log(
          '[invokeBuiltinTool] Authorization complete, retrying tool call: messageId=%s, tool=%s',
          id,
          payload.apiName,
        );
        result = await useToolStore
          .getState()
          .invokeBuiltinTool(payload.identifier, payload.apiName, params, {
            agentId,
            groupId,
            groupOrchestration,
            messageId: id,
            operationId,
            registerAfterCompletion,
            signal: operation?.abortController?.signal,
            stepContext,
            topicId,
            workingDirectory: getEffectiveWorkingDirectory(agentId),
          });
      }

      // When error exists but content is empty, backfill error message into content.
      // See resolveToolMessageContent: a tool message must NEVER be persisted with
      // empty content, or the model reads it as "succeeded with no output".
      const content = resolveToolMessageContent({
        content: result.content,
        error: result.error,
        toolName: `${payload.identifier}/${payload.apiName}`,
      });

      // Use optimisticUpdateToolMessage to batch update content, state, error, metadata
      await optimisticUpdateToolMessage(
        id,
        {
          content,
          metadata: result.metadata,
          pluginError: result.error
            ? {
                body: result.error.body,
                message: result.error.message,
                type: result.error.type as any,
              }
            : undefined,
          pluginState: result.state,
        },
        context,
      );

      // If result.stop is true, the tool wants to stop execution flow
      // This is handled by returning from the function (no further processing)
      if (result.stop) {
        log('[invokeBuiltinTool] Executor returned stop=true, stopping execution');
      }

      if (
        !result.error &&
        payload.identifier === 'lobe-skills' &&
        payload.apiName === 'activateSkill'
      ) {
        const skillName = String(params.skillName || params.name || '');
        if (skillName) {
          reportClientSkillMarketUsage(skillName, agentId);
        }
      }

      // Return the result for call_tool executor to use
      return result;
    }

    // All builtin tools should be handled by the executor registry above
    // If we reach here, it means the tool is not registered
    console.error(
      `[invokeBuiltinTool] No executor found for: ${payload.identifier}/${payload.apiName}`,
    );
    return {
      content: `Tool ${payload.identifier}/${payload.apiName} is not available`,
      error: { type: 'ToolNotFound', message: 'No executor found' },
      success: false,
    };
  };

  invokeDefaultTypePlugin = async (id: string, payload: any): Promise<string | undefined> => {
    const { internal_callPluginApi } = this.#get();

    const data = await internal_callPluginApi(id, payload);

    if (!data) return;

    return data;
  };

  invokeKlavisTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    return this.#get().internal_invokeRemoteToolPlugin(
      id,
      payload,
      klavisExecutor,
      'invokeKlavisTypePlugin',
    );
  };

  invokeLobehubSkillTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    return this.#get().internal_invokeRemoteToolPlugin(
      id,
      payload,
      lobehubSkillExecutor,
      'invokeLobehubSkillTypePlugin',
    );
  };

  invokeMarkdownTypePlugin = async (id: string, payload: ChatToolPayload): Promise<void> => {
    const { internal_callPluginApi } = this.#get();

    await internal_callPluginApi(id, payload);
  };

  invokeStandaloneTypePlugin = async (id: string, payload: ChatToolPayload): Promise<void> => {
    const result = await useToolStore.getState().validatePluginSettings(payload.identifier);
    if (!result) return;

    // if the plugin settings is not valid, then set the message with error type
    if (!result.valid) {
      // Get message to extract agentId/topicId
      const message = dbMessageSelectors.getDbMessageById(id)(this.#get());
      const updateResult = await messageService.updateMessageError(
        id,
        {
          body: {
            error: result.errors,
            message: '[plugin] your settings is invalid with plugin manifest setting schema',
          },
          message: t('response.PluginSettingsInvalid', { ns: 'error' }),
          type: PluginErrorType.PluginSettingsInvalid as any,
        },
        {
          agentId: message?.agentId,
          topicId: message?.topicId,
        },
      );

      if (updateResult?.success && updateResult.messages) {
        this.#get().replaceMessages(updateResult.messages, {
          context: { agentId: message?.agentId || '', topicId: message?.topicId },
        });
      }
      return;
    }
  };

  invokeMCPTypePlugin = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    let data: MCPToolCallResult | undefined;

    // Get message to extract agentId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[invokeMCPTypePlugin] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    const context = operationId ? { operationId } : undefined;

    try {
      let result = await mcpService.invokeMcpToolCall(payload, {
        signal: abortController?.signal,
        topicId: message?.topicId,
      });

      if (result?.error?.type === FEISHU_AUTH_REQUIRED) {
        await this.#get().optimisticUpdateToolMessage(
          id,
          {
            content: '',
            pluginError: result.error,
            pluginState: result.state,
          },
          context,
        );

        try {
          await feishuTokenService.waitForUserAuthorization(result.error.authUrl);
        } catch {
          log(
            '[invokeMCPTypePlugin] Feishu auth cancelled or failed: messageId=%s, tool=%s',
            id,
            payload.apiName,
          );
          return;
        }

        result = await mcpService.invokeMcpToolCall(payload, {
          signal: abortController?.signal,
          topicId: message?.topicId,
        });
      }

      if (!!result) data = result;
    } catch (error) {
      console.error(error);
      const err = error as Error;

      // ignore the aborted request error
      if (err.message.includes('The user aborted a request.')) {
        log('[invokeMCPTypePlugin] Request aborted: messageId=%s, tool=%s', id, payload.apiName);
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          this.#get().replaceMessages(result.messages, {
            context: { agentId: message?.agentId || '', topicId: message?.topicId },
          });
        }
      }
    }

    // If error occurred, exit

    if (!data) return;

    // Truncate content to prevent context overflow
    const truncatedContent = truncateToolResult(data.content || (data.error as any)?.message || '');

    // operationId already declared above, reuse it

    // Use optimisticUpdateToolMessage to update content and state/error in a single call
    await this.#get().optimisticUpdateToolMessage(
      id,
      {
        content: truncatedContent,
        pluginError: data.success ? null : data.error,
        pluginState:
          data.success || data.error?.type === FEISHU_AUTH_REQUIRED ? data.state : undefined,
      },
      context,
    );

    if (data.success) {
      reportClientMcpMarketUsage(payload.identifier, message?.agentId);
    }

    return truncatedContent;
  };

  internal_invokeRemoteToolPlugin = async (
    id: string,
    payload: ChatToolPayload,
    executor: RemoteToolExecutor,
    logPrefix: string,
  ): Promise<string | undefined> => {
    let data: MCPToolCallResult | undefined;

    // Get message to extract sessionId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[%s] messageId=%s, tool=%s, operationId=%s, aborted=%s',
      logPrefix,
      id,
      payload.apiName,
      operationId,
      abortController?.signal.aborted,
    );

    try {
      data = await executor(payload);
    } catch (error) {
      console.error(`[${logPrefix}] Error:`, error);

      // ignore the aborted request error
      const err = error as Error;
      if (err.message.includes('aborted')) {
        log('[%s] Request aborted: messageId=%s, tool=%s', logPrefix, id, payload.apiName);
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          this.#get().replaceMessages(result.messages, {
            context: {
              agentId: message?.agentId,
              topicId: message?.topicId,
            },
          });
        }
      }
    }

    // If error occurred, exit
    if (!data) return;

    const remoteContent = data.content || (data.error as any)?.message || '';
    const context = operationId ? { operationId } : undefined;

    // Use optimisticUpdateToolMessage to update content and state/error in a single call
    await this.#get().optimisticUpdateToolMessage(
      id,
      {
        content: remoteContent,
        pluginError: data.success ? null : data.error,
        pluginState: data.success ? data.state : undefined,
      },
      context,
    );

    return remoteContent;
  };

  internal_callPluginApi = async (
    id: string,
    payload: ChatToolPayload,
  ): Promise<string | undefined> => {
    const { optimisticUpdateMessageContent } = this.#get();
    let data: string;

    // Get message to extract agentId/topicId
    const message = dbMessageSelectors.getDbMessageById(id)(this.#get());

    // Get abort controller from operation
    const operationId = this.#get().messageOperationMap[id];
    const operation = operationId ? this.#get().operations[operationId] : undefined;
    const abortController = operation?.abortController;

    log(
      '[internal_callPluginApi] messageId=%s, plugin=%s, operationId=%s, aborted=%s',
      id,
      payload.identifier,
      operationId,
      abortController?.signal.aborted,
    );

    try {
      const res = await chatService.runPluginApi(payload, {
        signal: abortController?.signal,
        trace: { observationId: message?.observationId, traceId: message?.traceId },
      });
      data = res.text;

      // save traceId
      if (res.traceId) {
        await messageService.updateMessage(id, { traceId: res.traceId });
      }
    } catch (error) {
      console.error(error);
      const err = error as Error;

      // ignore the aborted request error
      if (err.message.includes('The user aborted a request.')) {
        log(
          '[internal_callPluginApi] Request aborted: messageId=%s, plugin=%s',
          id,
          payload.identifier,
        );
      } else {
        const result = await messageService.updateMessageError(id, error as any, {
          agentId: message?.agentId,
          topicId: message?.topicId,
        });
        if (result?.success && result.messages) {
          this.#get().replaceMessages(result.messages, {
            context: { agentId: message?.agentId || '', topicId: message?.topicId },
          });
        }
      }

      data = '';
    }
    // If error occurred, exit
    if (!data) return;

    // operationId already declared above, reuse it
    const context = operationId ? { operationId } : undefined;

    await optimisticUpdateMessageContent(id, data, undefined, context);

    return data;
  };
}

export type PluginTypesAction = Pick<PluginTypesActionImpl, keyof PluginTypesActionImpl>;
