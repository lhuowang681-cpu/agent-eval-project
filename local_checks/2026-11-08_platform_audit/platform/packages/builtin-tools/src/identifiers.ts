import { LobeActivatorManifest } from '@lobechat/builtin-tool-activator';
import { AgentBuilderManifest } from '@lobechat/builtin-tool-agent-builder';
import { AgentDocumentsManifest } from '@lobechat/builtin-tool-agent-documents';
import { AgentManagementManifest } from '@lobechat/builtin-tool-agent-management';
import { CalculatorManifest } from '@lobechat/builtin-tool-calculator';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { GroupAgentBuilderManifest } from '@lobechat/builtin-tool-group-agent-builder';
import { GroupManagementManifest } from '@lobechat/builtin-tool-group-management';
import { KnowledgeBaseManifest } from '@lobechat/builtin-tool-knowledge-base';
import { LobeAgentManifest } from '@lobechat/builtin-tool-lobe-agent';
import { LocalSystemManifest } from '@lobechat/builtin-tool-local-system';
import { MemoryManifest } from '@lobechat/builtin-tool-memory';
import { NotebookManifest } from '@lobechat/builtin-tool-notebook';
import { PageAgentManifest } from '@lobechat/builtin-tool-page-agent';
import { SkillStoreManifest } from '@lobechat/builtin-tool-skill-store';
import { SkillsManifest } from '@lobechat/builtin-tool-skills';
import { TopicReferenceManifest } from '@lobechat/builtin-tool-topic-reference';
import { WebBrowsingManifest } from '@lobechat/builtin-tool-web-browsing';

export const builtinToolIdentifiers: string[] = [
  AgentBuilderManifest.identifier,
  AgentDocumentsManifest.identifier,
  AgentManagementManifest.identifier,
  CalculatorManifest.identifier,
  LocalSystemManifest.identifier,
  WebBrowsingManifest.identifier,
  KnowledgeBaseManifest.identifier,
  CloudSandboxManifest.identifier,
  PageAgentManifest.identifier,
  SkillsManifest.identifier,
  GroupAgentBuilderManifest.identifier,
  GroupManagementManifest.identifier,
  LobeAgentManifest.identifier,
  MemoryManifest.identifier,
  NotebookManifest.identifier,
  TopicReferenceManifest.identifier,
  LobeActivatorManifest.identifier,
  SkillStoreManifest.identifier,
];
