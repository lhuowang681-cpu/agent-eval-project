export interface SystemAgentItem {
  customPrompt?: string;
  enabled?: boolean;
  model: string;
  provider: string;
}

export interface QueryRewriteSystemAgent extends Omit<SystemAgentItem, 'enabled'> {
  enabled: boolean;
}

export interface UserSystemAgentConfig {
  agentMeta: SystemAgentItem;
  generationTopic: SystemAgentItem;
  historyCompress: SystemAgentItem;
  memoryAnalysis: SystemAgentItem;
  queryRewrite: QueryRewriteSystemAgent;
  thread: SystemAgentItem;
  topic: SystemAgentItem;
  translation: SystemAgentItem;
  visualUnderstanding: SystemAgentItem;
}

export type UserSystemAgentConfigKey = keyof UserSystemAgentConfig;
