/**
 * Server-side Agent Tools Engine
 *
 * This module provides the same functionality as the frontend `createAgentToolsEngine`,
 * but fetches data from the database instead of frontend stores.
 *
 * Key differences from frontend:
 * - Gets installed plugins from context (fetched from database)
 * - Gets model capabilities from provided function
 * - No dependency on frontend stores (useToolStore, useAgentStore, etc.)
 */
import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu';
import { builtinMcpManifests } from '@lobechat/builtin-mcps';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { buildWebBrowsingManifest, WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import {
  alwaysOnToolIds,
  builtinTools,
  defaultToolIds,
  disabledBuiltinToolIds,
} from '@lobechat/builtin-tools';
import { createEnableChecker, type LobeToolManifest } from '@lobechat/context-engine';
import { ToolsEngine } from '@lobechat/context-engine';
import debug from 'debug';

import { toolsEnv } from '@/envs/tools';
import { executionTargetToRuntimeMode, resolveExecutionTarget } from '@/helpers/executionTarget';

import {
  type ServerAgentToolsContext,
  type ServerAgentToolsEngineConfig,
  type ServerCreateAgentToolsEngineParams,
} from './types';

export type {
  InstalledPlugin,
  ServerAgentToolsContext,
  ServerAgentToolsEngineConfig,
  ServerCreateAgentToolsEngineParams,
} from './types';

const log = debug('lobe-server:agent-tools-engine');

/**
 * Initialize ToolsEngine with server-side context
 *
 * This is the server-side equivalent of frontend's `createToolsEngine`
 *
 * @param context - Server context with installed plugins and model checker
 * @param config - Optional configuration
 * @returns ToolsEngine instance
 */
export const createServerToolsEngine = (
  context: ServerAgentToolsContext,
  config: ServerAgentToolsEngineConfig = {},
): ToolsEngine => {
  const { enableChecker, additionalManifests = [], defaultToolIds } = config;

  // Get plugin manifests from installed plugins (from database)
  const pluginManifests = context.installedPlugins
    .map((plugin) => plugin.manifest as LobeToolManifest)
    .filter(Boolean);

  // Get all builtin tool manifests (runtime systemRole for web browsing when public crawl is off)
  const builtinManifests = builtinTools.map((tool) => {
    if (
      tool.identifier === WebBrowsingManifest.identifier &&
      toolsEnv.DISABLE_PUBLIC_WEB_PAGE_CRAWL
    ) {
      return buildWebBrowsingManifest({ publicWebCrawlDisabled: true }) as LobeToolManifest;
    }
    return tool.manifest as LobeToolManifest;
  });

  // Combine all manifests
  const allManifests = [
    ...pluginManifests,
    ...builtinManifests,
    ...builtinMcpManifests,
    ...additionalManifests,
  ];

  log(
    'Creating ToolsEngine with %d plugin manifests, %d builtin manifests, %d additional manifests',
    pluginManifests.length,
    builtinManifests.length,
    additionalManifests.length,
  );

  return new ToolsEngine({
    defaultToolIds,
    enableChecker,
    functionCallChecker: context.isModelSupportToolUse,
    manifestSchemas: allManifests,
  });
};

/**
 * Create a ToolsEngine for agent chat with server-side context
 *
 * This is the server-side equivalent of frontend's `createAgentToolsEngine`
 *
 * @param context - Server context with installed plugins and model checker
 * @param params - Agent config and model info
 * @returns ToolsEngine instance configured for the agent
 */
export const createServerAgentToolsEngine = (
  context: ServerAgentToolsContext,
  params: ServerCreateAgentToolsEngineParams,
): ToolsEngine => {
  const {
    additionalManifests,
    agentConfig,
    deviceContext,
    executionPlan,
    globalMemoryEnabled = false,
    hasEnabledKnowledgeBases = false,
    model,
    provider,
    forceEnableCloudSandbox = false,
    sandboxEnabled = true,
    uninstalledBuiltinTools = [],
  } = params;
  const searchMode = agentConfig.chatConfig?.searchMode ?? 'auto';
  const isSearchEnabled = searchMode !== 'off';

  // A server configured with a device-gateway is serving desktop-class users.
  const isDesktopClient = !!deviceContext?.gatewayConfigured;

  // Tool gate derived from the run's resolved execution target — THE single
  // source of truth. Do NOT read the legacy per-platform
  // `chatConfig.runtimeEnv.runtimeMode[platform]`: that field is written by the
  // UI only for the current client's platform slot, so a `sandbox` selection
  // leaves a stale `desktop:'local'` behind, and a gateway-configured server
  // (platform='desktop') would then re-enable device tools the user turned off.
  // Callers without a plan (focused sub-agents) fall back to the agencyConfig.
  const executionTarget =
    executionPlan?.target ??
    resolveExecutionTarget(agentConfig.agencyConfig, {
      isDesktop: isDesktopClient,
      sandboxEnabled,
    });
  const runtimeMode = executionTargetToRuntimeMode(executionTarget);
  // Device tools (local-system, remote-device proxy) only exist for
  // device-capable targets. `none`/`sandbox` never touch a device.
  const deviceCapable = executionTarget === 'local' || executionTarget === 'device';

  log(
    'Creating agent tools engine for model=%s, provider=%s, searchMode=%s, executionTarget=%s, runtimeMode=%s, deviceCapable=%s, additionalManifests=%d, deviceGateway=%s',
    model,
    provider,
    searchMode,
    executionTarget,
    runtimeMode,
    deviceCapable,
    additionalManifests?.length ?? 0,
    !!deviceContext?.gatewayConfigured,
  );

  return createServerToolsEngine(context, {
    // Pass additional manifests (e.g., TripYoYo Skills)
    additionalManifests,
    // Add default tools based on configuration
    defaultToolIds,
    enableChecker: createEnableChecker({
      rules: {
        // User-selected plugins
        ...Object.fromEntries((agentConfig.plugins ?? []).map((id) => [id, true])),
        // Always-on builtin tools
        ...Object.fromEntries(alwaysOnToolIds.map((id) => [id, true])),
        // System-level rules (may override user selection for specific tools)
        [CloudSandboxManifest.identifier]:
          sandboxEnabled && (runtimeMode === 'cloud' || forceEnableCloudSandbox),
        // Feishu MCP's auth is a client-side, interactive OAuth flow (see
        // src/services/mcp.ts) — it has no headless path and never works in a
        // run dispatched to a device. Whenever a device is auto-activated,
        // lark-cli (the Feishu CLI skill) covers the same ground with more
        // capability, so force Feishu MCP off and let the model use that
        // instead. Bare web sessions (no device) keep Feishu MCP enabled,
        // since lark-cli isn't reachable there at all.
        [FEISHU_MCP_IDENTIFIER]: !deviceContext?.autoActivated,
        [KnowledgeBaseManifest.identifier]: hasEnabledKnowledgeBases,
        // Local-system base tool: only for the in-process `local` target with an
        // online, auto-activated device. For the `device` target it is injected
        // at step level after `activateDevice` (see buildStepToolDelta), so it is
        // intentionally NOT enabled here.
        [LocalSystemManifest.identifier]:
          runtimeMode === 'local' &&
          !!deviceContext?.gatewayConfigured &&
          !!deviceContext?.deviceOnline &&
          !!deviceContext?.autoActivated,
        [MemoryManifest.identifier]: globalMemoryEnabled,
        // Remote-device proxy: only for device-capable targets, when a proxy
        // exists, no device is auto-activated yet, AND no specific device is
        // explicitly bound. `sandbox`/`none` are not deviceCapable → never shown.
        [RemoteDeviceManifest.identifier]:
          deviceCapable &&
          !!deviceContext?.gatewayConfigured &&
          !deviceContext?.autoActivated &&
          !deviceContext?.boundDeviceId,
        [WebBrowsingManifest.identifier]: isSearchEnabled,
        ...Object.fromEntries(disabledBuiltinToolIds.map((id) => [id, false])),
        // User-uninstalled builtin tools are forced off last so they override
        // agent.plugins[] and any system rule above (an uninstalled tool must
        // never have its manifest sent, even if still referenced in plugins[]).
        ...Object.fromEntries(uninstalledBuiltinTools.map((id) => [id, false])),
      },
    }),
  });
};
