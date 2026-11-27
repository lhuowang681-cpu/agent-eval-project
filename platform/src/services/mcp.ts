import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu/client';
import { CURRENT_VERSION, isDesktop } from '@lobechat/const';
import {
  type ChatToolPayload,
  type CheckMcpInstallResult,
  type CustomPluginMetadata,
} from '@lobechat/types';
import { isLocalOrPrivateUrl, safeParseJSON, safeParsePartialJSON } from '@lobechat/utils';
import { type PluginManifest } from '@lobehub/market-sdk';
import { type CallReportRequest } from '@lobehub/market-types';
import superjson from 'superjson';

import { type MCPToolCallResult } from '@/libs/mcp';
import { toolsClient } from '@/libs/trpc/client';
import { ensureElectronIpc } from '@/utils/electron/ipc';

import { withBbzaiMcpTokenHeader } from '../utils/mcpAdaToken';
import { discoverService } from './discover';
import { buildFeishuMcpParams, FEISHU_AUTH_REQUIRED, feishuTokenService } from './feishuToken';

/**
 * Calculate byte size of object
 * @param obj Object to calculate size of
 * @returns Byte size
 */
function calculateObjectSizeBytes(obj: any): number {
  try {
    const jsonString = JSON.stringify(obj);
    return new TextEncoder().encode(jsonString).length;
  } catch (error) {
    console.warn('Failed to calculate object size:', error);
    return 0;
  }
}

/**
 * 飞书 MCP 服务端可能在客户端自以为 token 有效时反过来拒绝它（token 服务端侧已失效，
 * 或缺某个 scope）。这类错误要收敛回授权卡片，而不是抛成普通 CALL_FAILED。
 * 仅在结果已判定失败 / 抛错时做关键字匹配，避免正常文档内容里出现 "token / 权限" 误触发。
 */
const FEISHU_AUTH_ERROR_PATTERN =
  /401|unauthor|forbidden|invalid[\s_-]*(?:access[\s_-]*)?token|token[\s_-]*(?:expired|invalid)|access[\s_-]*token|missing[\s_-]*(?:required[\s_-]*)?scope|permission[\s_-]*violation|未授权|令牌|权限不足|重新授权/i;

const looksLikeFeishuAuthError = (value: unknown): boolean => {
  if (!value) return false;
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    return false;
  }
  return FEISHU_AUTH_ERROR_PATTERN.test(text);
};

/**
 * 清掉这份已失效/权限不足的 token，重新取授权链接，构造与「客户端预检无 token」
 * 完全一致的 FEISHU_AUTH_REQUIRED 结果，让聊天里复用同一张授权卡片。
 */
const buildFeishuAuthRequiredResult = async (): Promise<MCPToolCallResult | undefined> => {
  await feishuTokenService.clearToken();
  const retry = await feishuTokenService.requestToken();
  if (retry.status !== 'auth_required') return undefined;

  return {
    content: '',
    error: { authUrl: retry.authUrl, type: FEISHU_AUTH_REQUIRED },
    state: { content: [] },
    success: false,
  };
};

class MCPService {
  async invokeMcpToolCall(
    payload: ChatToolPayload,
    { signal, topicId }: { signal?: AbortSignal; topicId?: string },
  ) {
    await discoverService.safeInjectMPToken();

    const { pluginSelectors } = await import('@/store/tool/selectors');
    const { getToolStoreState } = await import('@/store/tool/store');

    const s = getToolStoreState();
    const { identifier, arguments: args, apiName } = payload;

    const installPlugin = pluginSelectors.getInstalledPluginById(identifier)(s);
    const customPlugin = pluginSelectors.getCustomPluginById(identifier)(s);

    const plugin = installPlugin || customPlugin;

    // 飞书 MCP 是内置 MCP，不需要从 plugin store 中查找
    if (!plugin && identifier !== FEISHU_MCP_IDENTIFIER) return;

    // 飞书 MCP：需要动态获取 UAT，走独立的调用链路
    if (identifier === FEISHU_MCP_IDENTIFIER) {
      const tokenResult = await feishuTokenService.requestToken();

      if (tokenResult.status === 'auth_required') {
        return {
          content: '',
          error: { authUrl: tokenResult.authUrl, type: FEISHU_AUTH_REQUIRED },
          state: {
            content: [],
          },
          success: false,
        };
      }

      const uat = tokenResult.token;

      const feishuParams = buildFeishuMcpParams(uat);
      const feishuData = {
        args,
        env: undefined,
        meta: {
          customPluginInfo: undefined,
          isCustomPlugin: false,
          sessionId: topicId,
          version: '1.0.0',
        },
        params: feishuParams,
        toolName: apiName,
      };

      // 飞书 MCP 赴 HTTP TRPC 链路（和普通 HTTP MCP 一样）
      let feishuResult: MCPToolCallResult | undefined;
      let feishuSuccess = false;
      let feishuErrorCode: string | undefined;
      let feishuErrorMessage: string | undefined;

      try {
        feishuResult = await toolsClient.mcp.callTool.mutate(feishuData, { signal });
        feishuSuccess = true;

        // 服务端未抛错但 tool 结果判定失败、且像鉴权错误 → 收敛为授权卡片
        if (
          feishuResult?.success === false &&
          looksLikeFeishuAuthError(feishuResult.error ?? feishuResult.content)
        ) {
          const authRequired = await buildFeishuAuthRequiredResult();
          if (authRequired) return authRequired;
        }

        return feishuResult;
      } catch (error) {
        // 服务端以异常形式拒绝（token 失效 / 缺 scope）→ 收敛为授权卡片
        if (looksLikeFeishuAuthError((error as Error)?.message)) {
          const authRequired = await buildFeishuAuthRequiredResult();
          if (authRequired) return authRequired;
        }

        feishuErrorCode = 'CALL_FAILED';
        feishuErrorMessage = (error as Error).message;
        throw error;
      }
    }

    // 飞书 MCP 已在上方处理并返回，此处 plugin 必然存在
    if (!plugin) return;

    const connection = plugin.customParams?.mcp;
    const settingsEntries = plugin.settings
      ? Object.entries(plugin.settings as Record<string, any>).filter(
          ([, value]) => value !== undefined && value !== null,
        )
      : [];
    const pluginSettings =
      settingsEntries.length > 0
        ? settingsEntries.reduce<Record<string, unknown>>((acc, [key, value]) => {
            acc[key] = value;

            return acc;
          }, {})
        : undefined;

    const params = {
      ...connection,
      name: identifier,
    } as any;

    if (connection?.type === 'http') {
      params.headers = {
        ...connection.headers,
        ...pluginSettings,
      };
    }

    if (connection?.type === 'stdio') {
      params.env = {
        ...connection?.env,
        ...pluginSettings,
      };
    }

    const isStdio = plugin?.customParams?.mcp?.type === 'stdio';
    const isCloud = plugin?.customParams?.mcp?.type === 'cloud';
    const isCustomPlugin = !!customPlugin;

    // Build meta for server-side reporting
    const meta = {
      customPluginInfo: isCustomPlugin
        ? {
            avatar: plugin.manifest?.meta.avatar,
            description: plugin.manifest?.meta.description,
            name: plugin.manifest?.meta.title,
          }
        : undefined,
      isCustomPlugin,
      sessionId: topicId,
      version: plugin.manifest?.version || 'unknown',
    };

    const data = {
      // For desktop IPC, always pass a record/object for tool "arguments"
      // (IPC layer will superjson serialize the whole payload).
      args: isDesktop && isStdio ? (safeParseJSON(args) ?? safeParsePartialJSON(args) ?? {}) : args,
      env: connection?.type === 'stdio' ? params.env : (pluginSettings ?? connection?.env),
      meta,
      params,
      toolName: apiName,
    };

    // Record call start time
    const callStartTime = Date.now();
    let success = false;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    let result: MCPToolCallResult | undefined;

    try {
      // For cloud type, call via cloud gateway
      if (isCloud) {
        // Parse args
        const apiParams = safeParseJSON(args) ?? safeParsePartialJSON(args) ?? {};

        // Call cloud gateway via tools market endpoint
        // Server will automatically get user access token from database
        // and format the result to MCPToolCallResult
        // Server-side also handles telemetry reporting
        result = await toolsClient.market.callCloudMcpEndpoint.mutate({
          apiParams,
          identifier,
          meta,
          toolName: apiName,
        });
      } else if (isDesktop && isStdio) {
        // For desktop and stdio, use IPC (main process)
        // Note: IPC doesn't support AbortSignal yet
        const serialized = superjson.serialize(data);
        const serializedResult = await ensureElectronIpc().mcp.callTool(serialized as any);
        result = superjson.deserialize(serializedResult as any) as any;
      } else {
        // For other types, use the toolsClient
        result = await toolsClient.mcp.callTool.mutate(data, { signal });
      }

      success = true;
      return result;
    } catch (error) {
      const err = error as Error;
      errorCode = 'CALL_FAILED';
      errorMessage = err.message;

      // Rethrow error, maintain original error handling logic
      throw error;
    } finally {
      // HTTP/SSE/streamable types: reporting is handled by server-side via mcp.callTool
      // Cloud type: reporting is handled by server-side via market.callCloudMcpEndpoint
      // Only report from frontend for stdio types (desktop only)
      if (isStdio) {
        const callEndTime = Date.now();
        const callDurationMs = callEndTime - callStartTime;

        // Calculate request size
        const inputParams = safeParseJSON(args) || args;
        const requestSizeBytes = calculateObjectSizeBytes(inputParams);
        // Calculate response size
        const responseSizeBytes = success && result ? calculateObjectSizeBytes(result.state) : 0;

        // Construct report data
        const reportData: CallReportRequest = {
          callDurationMs,
          customPluginInfo: meta.customPluginInfo,
          errorCode,
          errorMessage,
          identifier,
          isCustomPlugin,
          metadata: {
            appVersion: CURRENT_VERSION,
            command: plugin.customParams?.mcp?.command,
            mcpType: plugin.customParams?.mcp?.type,
          },
          methodName: apiName,
          methodType: 'tool' as const,
          requestSizeBytes,
          responseSizeBytes,
          sessionId: topicId,
          success,
          version: meta.version,
        };

        // Asynchronously report without affecting main flow
        discoverService.reportPluginCall(reportData).catch((reportError) => {
          console.warn('Failed to report MCP tool call:', reportError);
        });
      }
    }
  }

  async getStreamableMcpServerManifest(
    params: {
      auth?: {
        accessToken?: string;
        token?: string;
        type: 'none' | 'bearer' | 'oauth2';
      };
      headers?: Record<string, string>;
      identifier: string;
      metadata?: CustomPluginMetadata;
      url: string;
    },
    signal?: AbortSignal,
  ) {
    // If in Desktop mode and URL is local address, use IPC (main process)
    // This avoids accessing user local services through remote server in production
    if (isDesktop && isLocalOrPrivateUrl(params.url)) {
      // Note: IPC doesn't support AbortSignal yet
      const [{ useUserStore }, { userProfileSelectors }] = await Promise.all([
        import('@/store/user'),
        import('@/store/user/selectors'),
      ]);
      const mcpAdaToken = userProfileSelectors.mcpAdaToken(useUserStore.getState());
      const serialized = superjson.serialize(withBbzaiMcpTokenHeader(params, mcpAdaToken));
      const serializedResult = await ensureElectronIpc().mcp.getStreamableMcpServerManifest(
        serialized as any,
      );
      return superjson.deserialize(serializedResult as any) as any;
    }

    // Otherwise use toolsClient (via server relay)
    return toolsClient.mcp.getStreamableMcpServerManifest.query(params, { signal });
  }

  async getStdioMcpServerManifest(
    stdioParams: {
      args?: string[];
      command: string;
      env?: Record<string, string>;
      name: string;
    },
    metadata?: CustomPluginMetadata,
    _signal?: AbortSignal,
  ) {
    void _signal;
    // Note: IPC doesn't support AbortSignal yet
    const serialized = superjson.serialize({ ...stdioParams, metadata });
    const serializedResult = await ensureElectronIpc().mcp.getStdioMcpServerManifest(
      serialized as any,
    );
    return superjson.deserialize(serializedResult as any) as any;
  }

  /**
   * Check MCP plugin installation status
   * @param manifest MCP plugin manifest
   * @param signal AbortSignal for canceling request
   * @returns Installation check result
   */
  async checkInstallation(
    manifest: PluginManifest,
    _signal?: AbortSignal,
  ): Promise<CheckMcpInstallResult> {
    void _signal;
    // Pass all deployment options to main process for checking
    // Note: IPC doesn't support AbortSignal yet
    const serialized = superjson.serialize({
      deploymentOptions: manifest.deploymentOptions as any,
    });
    const serializedResult = await ensureElectronIpc().mcp.validMcpServerInstallable(
      serialized as any,
    );
    return superjson.deserialize(serializedResult as any) as any;
  }
}

export const mcpService = new MCPService();
