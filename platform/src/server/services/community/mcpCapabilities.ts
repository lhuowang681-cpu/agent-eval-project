/**
 * Extract tools/prompts/resources capabilities from an MCP manifest.
 *
 * Shared between {@link CommunityService} (publish/install flows) and
 * {@link ShareService} (point-to-point share snapshots) so the two never
 * diverge — previously `share.ts` carried an inline copy that dropped the
 * raw arrays.
 */

export interface McpManifestLike {
  meta?: {
    avatar?: string;
    description?: string;
    icon?: string;
    readme?: string;
    tags?: string[];
    title?: string;
  };
  prompts?: unknown[];
  resources?: unknown[];
  tools?: unknown[];
}

export const extractMcpCapabilities = (manifest?: McpManifestLike | null) => {
  // If manifest has MCP-format tools/prompts/resources, use them directly
  const tools = manifest?.tools;
  const prompts = manifest?.prompts;
  const resources = manifest?.resources;

  // For HTTP MCP manifests stored in old format (api array), 'tools' might be undefined
  // In that case, the 'api' array contains the tool definitions in LobeChatPluginManifest format
  // We count the api array length as toolsCount
  const apiTools = (manifest as any)?.api;

  const toolsCount = tools?.length ?? apiTools?.length ?? 0;
  const promptsCount = prompts?.length ?? 0;
  const resourcesCount = resources?.length ?? 0;

  return {
    capabilities: {
      tools: toolsCount > 0,
      prompts: promptsCount > 0,
      resources: resourcesCount > 0,
    },
    toolsCount,
    promptsCount,
    resourcesCount,
    // Also preserve the raw tools/prompts/resources arrays for the manifest
    rawTools: tools,
    rawPrompts: prompts,
    rawResources: resources,
  };
};
