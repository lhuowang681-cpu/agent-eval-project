import { DEFAULT_PROVIDER } from '@lobechat/business-const';
import {
  type LobeAgentChatConfig,
  type LobeAgentConfig,
  type LobeAgentTTSConfig,
  type UserDefaultAgent,
} from '@lobechat/types';

import { DEFAULT_AGENT_META } from '../meta';
import { isDesktop } from '../version';
import { DEFAULT_MODEL } from './llm';

export const DEFAUTT_AGENT_TTS_CONFIG: LobeAgentTTSConfig = {
  showAllLocaleVoice: false,
  sttLocale: 'auto',
  ttsService: 'openai',
  voice: {
    openai: 'alloy',
  },
};

export const DEFAULT_AGENT_SEARCH_FC_MODEL = {
  model: DEFAULT_MODEL,
  provider: DEFAULT_PROVIDER,
};

/**
 * Feishu skills are pinned-on by default for new agents, per environment:
 * - desktop: `lobe-feishu-cli` (drives the bundled lark-cli binary, desktop-only)
 * - web:     `builtin-feishu-mcp` (server-side Feishu MCP, web-only on desktop)
 *
 * Identifiers are kept as literals here to avoid pulling the builtin-tool /
 * builtin-skill packages into this low-level const package. Both skills are
 * non-uninstallable (see `nonUninstallableBuiltinToolIds` and the builtin skill
 * popover wiring); users may still toggle them to "auto" via the "..." menu.
 *
 * `lobe-artifacts` is also pinned by default — it is a non-uninstallable
 * builtin skill that should be on for every new agent.
 */
const DEFAULT_FEISHU_PLUGIN = isDesktop ? 'lobe-feishu-cli' : 'builtin-feishu-mcp';

export const DEFAULT_AGENT_CHAT_CONFIG: LobeAgentChatConfig = {
  autoCreateTopicThreshold: 2,
  enableAdaptiveThinking: true,
  enableAutoCreateTopic: true,
  enableCompressHistory: true,
  enableContextCompression: true,
  enableHistoryCount: false,
  enableReasoning: true,
  enableStreaming: true,
  historyCount: 20,
  reasoningBudgetToken: 1024,
  searchFCModel: DEFAULT_AGENT_SEARCH_FC_MODEL,
  searchMode: 'auto',
};

export const DEFAULT_AGENT_CONFIG: LobeAgentConfig = {
  chatConfig: DEFAULT_AGENT_CHAT_CONFIG,
  model: DEFAULT_MODEL,
  openingQuestions: [],
  params: {
    frequency_penalty: 0,
    presence_penalty: 0,
    temperature: 1,
    top_p: 1,
  },
  plugins: [DEFAULT_FEISHU_PLUGIN, 'lobe-artifacts'],
  provider: DEFAULT_PROVIDER,
  systemRole: '',
  tts: DEFAUTT_AGENT_TTS_CONFIG,
};

export const DEFAULT_AGENT: UserDefaultAgent = {
  config: DEFAULT_AGENT_CONFIG,
  meta: DEFAULT_AGENT_META,
};
