/**
 * Lobe Activator Executor
 *
 * Creates and exports the ActivatorExecutor instance for registration.
 * Resolves tool manifests from the tool store (installedPlugins + builtinTools).
 *
 * Replaces the former lobe-tools activator (LobeToolsManifest) — aligned with
 * lobehub upstream which splits the activator into its own `lobe-activator` tool.
 *
 * State tracking (getActivatedToolIds / markActivated) is intentionally a no-op
 * because the activated state is persisted in message pluginState and accumulated
 * by selectActivatedToolIdsFromMessages at each agentic loop step.
 *
 * `activateSkill` is intentionally not wired here (service.activateSkill unset) —
 * the runtime will return "Skill activation is not available." for that API.
 * Skill activation is handled by the lobe-skills tool instead.
 */
import { builtinMcpManifests } from '@lobechat/builtin-mcps';
import {
  ActivatorExecutionRuntime,
  type ActivatorRuntimeService,
  type ToolManifestInfo,
} from '@lobechat/builtin-tool-activator/executionRuntime';
import { ActivatorExecutor } from '@lobechat/builtin-tool-activator/executor';
import { alwaysOnToolIds, isBuiltinToolDisabledForAgents } from '@lobechat/builtin-tools';

import { getToolStoreState } from '@/store/tool';
import { toolSelectors } from '@/store/tool/selectors/tool';

const service: ActivatorRuntimeService = {
  getActivatedToolIds: () => alwaysOnToolIds.filter((id) => !isBuiltinToolDisabledForAgents(id)),
  getToolManifests: async (identifiers: string[]): Promise<ToolManifestInfo[]> => {
    const s = getToolStoreState();

    // Only allow activation of tools that passed discovery filters
    // (discoverable, platform-available, not internal/hidden)
    const discoverable = new Set(
      toolSelectors.availableToolsForDiscovery(s).map((t) => t.identifier),
    );
    const allowedIds = identifiers.filter(
      (id) => discoverable.has(id) && !isBuiltinToolDisabledForAgents(id),
    );

    const results: ToolManifestInfo[] = [];

    for (const id of allowedIds) {
      // Search builtin tools
      const builtin = s.builtinTools.find((t) => t.identifier === id);
      if (builtin) {
        results.push({
          apiDescriptions: builtin.manifest.api.map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: builtin.manifest.meta?.avatar,
          identifier: builtin.identifier,
          name: builtin.manifest.meta?.title ?? builtin.identifier,
          systemRole: builtin.manifest.systemRole,
        });
        continue;
      }

      // Search builtin MCP manifests
      const builtinMcp = builtinMcpManifests.find((m) => m.identifier === id);
      if (builtinMcp) {
        results.push({
          apiDescriptions: builtinMcp.api.map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: builtinMcp.meta?.avatar,
          identifier: builtinMcp.identifier,
          name: builtinMcp.meta?.title ?? builtinMcp.identifier,
          systemRole: builtinMcp.systemRole,
        });
        continue;
      }

      // Search installed plugins
      const plugin = s.installedPlugins.find((p) => p.identifier === id);
      if (plugin?.manifest) {
        results.push({
          apiDescriptions: (plugin.manifest.api || []).map((a) => ({
            description: a.description,
            name: a.name,
          })),
          avatar: plugin.manifest.meta?.avatar,
          identifier: plugin.identifier,
          name: plugin.manifest.meta?.title ?? plugin.identifier,
          systemRole: plugin.manifest.systemRole,
        });
      }
    }

    return results;
  },
  markActivated: () => {},
};

const runtime = new ActivatorExecutionRuntime({ service });

export const lobeActivatorExecutor = new ActivatorExecutor(runtime);
