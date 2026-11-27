import { type LobeChatDatabase } from '@lobechat/database';

import { type SandboxToolClient } from '../sandboxToolClient';

export interface RunBuildInToolContext {
  topicId?: string;
  userId?: string;
}

export interface OpenSandboxDeps {
  getSandboxClient: () => SandboxToolClient;
  serverDB?: LobeChatDatabase;
}

export interface RunBuildInToolsResponse {
  data?: {
    result: unknown;
    sessionExpiredAndRecreated: boolean;
    toolName: string;
  };
  error?: {
    code: string;
    details?: unknown;
    message: string;
  };
  success: boolean;
}

export type OpenSandboxRunBuildInTool = (
  toolName: string,
  params: Record<string, unknown>,
  context?: RunBuildInToolContext,
) => Promise<RunBuildInToolsResponse>;
