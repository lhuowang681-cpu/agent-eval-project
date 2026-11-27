/**
 * Shared tool filtering logic used across both runtime (ToolsEngine)
 * and display layer (selectors)
 */
import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu/client';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { isDesktop } from '@lobechat/const';

export interface ToolFilterContext {
  /**
   * Platform to evaluate against. Defaults to the ambient current runtime
   * (`isDesktop`). Pass an explicit value to answer a platform-independent
   * question, e.g. "would this tool be available on web" regardless of
   * which platform is currently running.
   */
  isDesktop?: boolean;
}

/**
 * Check if a tool should be enabled based on platform-specific constraints
 * @param toolId - The tool identifier to check
 * @param context - Optional platform override; defaults to the current runtime
 * @returns true if the tool should be enabled, false otherwise
 */
export const shouldEnableTool = (toolId: string, context: ToolFilterContext = {}): boolean => {
  const resolvedIsDesktop = context.isDesktop ?? isDesktop;

  // Filter LocalSystem tool in non-desktop environment
  if (toolId === LocalSystemManifest.identifier) {
    return resolvedIsDesktop;
  }

  // Feishu MCP is web-only: on desktop the bundled lark-cli (lobe-feishu-cli
  // skill) replaces it, and the MCP's browser OAuth (LarkAuth/window) can't run
  // in the desktop runtime anyway.
  if (toolId === FEISHU_MCP_IDENTIFIER) {
    return !resolvedIsDesktop;
  }

  return true;
};

/**
 * Filter tool IDs based on platform constraints
 * @param toolIds - Array of tool identifiers to filter
 * @returns Filtered array of tool identifiers
 */
export const filterToolIds = (toolIds: string[]): string[] => {
  return toolIds.filter((toolId) => shouldEnableTool(toolId));
};
