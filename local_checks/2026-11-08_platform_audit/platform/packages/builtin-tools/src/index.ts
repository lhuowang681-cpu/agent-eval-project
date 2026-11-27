import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu';
import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementManifest } from '@lobechat/builtin-tool-agent-management';
import { BriefManifest } from '@lobechat/builtin-tool-brief';
import { CalculatorManifest } from '@lobechat/builtin-tool-calculator';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { GroupAgentBuilderManifest } from '@lobechat/builtin-tool-group-agent-builder';
import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { PageAgentManifest } from '@lobechat/builtin-tool-page-agent';
import { RemoteDeviceManifest } from '@lobechat/builtin-tool-remote-device';
import { SkillStoreManifest } from '@lobechat/builtin-tool-skill-store';
import { SkillsManifest } from '@lobechat/builtin-tool-skills';
import { TaskManifest } from '@lobechat/builtin-tool-task';
import { TopicReferenceManifest } from '@lobechat/builtin-tool-topic-reference';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';
import { isDesktop, RECOMMENDED_SKILLS, RecommendedSkillType } from '@lobechat/const';
import { type LobeBuiltinTool } from '@lobechat/types';

/**
 * Default tool IDs that will always be added to the tools list.
 * Shared between frontend (createAgentToolsEngine) and server (createServerAgentToolsEngine).
 */
export const defaultToolIds = [
  LobeActivatorManifest.identifier,
  SkillsManifest.identifier,
  SkillStoreManifest.identifier,
  WebBrowsingManifest.identifier,
  KnowledgeBaseManifest.identifier,
  MemoryManifest.identifier,
  LocalSystemManifest.identifier,
  CloudSandboxManifest.identifier,
  TopicReferenceManifest.identifier,
  AgentDocumentsManifest.identifier,
  TaskManifest.identifier,
  LobeAgentManifest.identifier,
];

/**
 * Tool IDs that are always enabled regardless of user selection.
 * These are core system tools that the agent needs to function properly.
 * Includes `lobe-agent` (Plan/Todo + sub-agent dispatch), aligned with
 * lobehub's always-on treatment — even though TripYoYo doesn't have
 * lobehub's `enableAgentMode`/chat-vs-agent-mode distinction (see
 * chat-mode-and-controlbar-port memory), the agent still needs Plan/Todo
 * available unconditionally.
 */
export const alwaysOnToolIds = [
  LobeActivatorManifest.identifier,
  SkillsManifest.identifier,
  SkillStoreManifest.identifier,
  LobeAgentManifest.identifier,
];

/**
 * Builtin tool IDs that are not uninstallable by the user in the skill popover.
 * Includes the always-on fixed tools above plus project-specific builtin MCPs
 * (e.g. Feishu MCP) that ship as first-class non-removable skills.
 */
export const nonUninstallableBuiltinToolIds = [...alwaysOnToolIds, FEISHU_MCP_IDENTIFIER];

/**
 * Tool IDs to exclude from defaults when in manual skill-activate mode.
 * These are the tool/skill discovery tools that should be disabled when user wants precise control.
 * Other default tools (sandbox, web browsing, lobe-agent, etc.) remain available if enabled externally.
 *
 * Aligned with lobehub upstream: manual mode strips only discovery-oriented defaults instead of
 * skipping all defaults (which would also drop `lobe-agent`'s Plan/Todo APIs — see TripYoYo's
 * prior bug where the manual switch made the model hallucinate tool names).
 */
export const manualModeExcludeToolIds = [
  LobeActivatorManifest.identifier,
  SkillStoreManifest.identifier,
];

/**
 * Builtin tools that remain registered for compatibility but must not be exposed to agents.
 */
export const disabledBuiltinToolIds = [] as const;

export const isBuiltinToolDisabledForAgents = (identifier: string): boolean =>
  (disabledBuiltinToolIds as readonly string[]).includes(identifier);

export const builtinTools: LobeBuiltinTool[] = [
  {
    discoverable: false,
    hidden: true,
    identifier: LobeActivatorManifest.identifier,
    manifest: LobeActivatorManifest,
    type: 'builtin',
  },
  {
    identifier: TaskManifest.identifier,
    manifest: TaskManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: BriefManifest.identifier,
    manifest: BriefManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: SkillsManifest.identifier,
    manifest: SkillsManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: SkillStoreManifest.identifier,
    manifest: SkillStoreManifest,
    type: 'builtin',
  },
  {
    discoverable: isDesktop,
    hidden: true,
    identifier: LocalSystemManifest.identifier,
    manifest: LocalSystemManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: MemoryManifest.identifier,
    manifest: MemoryManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: WebBrowsingManifest.identifier,
    manifest: WebBrowsingManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: CloudSandboxManifest.identifier,
    manifest: CloudSandboxManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: KnowledgeBaseManifest.identifier,
    manifest: KnowledgeBaseManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: PageAgentManifest.identifier,
    manifest: PageAgentManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: AgentBuilderManifest.identifier,
    manifest: AgentBuilderManifest,
    type: 'builtin',
  },
  {
    identifier: AgentDocumentsManifest.identifier,
    manifest: AgentDocumentsManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: GroupAgentBuilderManifest.identifier,
    manifest: GroupAgentBuilderManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: GroupManagementManifest.identifier,
    manifest: GroupManagementManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: AgentManagementManifest.identifier,
    manifest: AgentManagementManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: LobeAgentManifest.identifier,
    manifest: LobeAgentManifest,
    type: 'builtin',
  },
  {
    identifier: CalculatorManifest.identifier,
    manifest: CalculatorManifest,
    type: 'builtin',
  },
  {
    hidden: true,
    identifier: RemoteDeviceManifest.identifier,
    manifest: RemoteDeviceManifest,
    type: 'builtin',
  },
  {
    discoverable: false,
    hidden: true,
    identifier: TopicReferenceManifest.identifier,
    manifest: TopicReferenceManifest,
    type: 'builtin',
  },
];

const recommendedBuiltinIds = new Set(
  RECOMMENDED_SKILLS.filter((s) => s.type === RecommendedSkillType.Builtin).map((s) => s.id),
);

/**
 * Non-hidden builtin tools that are NOT in RECOMMENDED_SKILLS.
 * These tools default to uninstalled and must be explicitly installed by the user from the Skill Store.
 */
export const defaultUninstalledBuiltinTools = builtinTools
  .filter((t) => !t.hidden && !recommendedBuiltinIds.has(t.identifier))
  .map((t) => t.identifier);
