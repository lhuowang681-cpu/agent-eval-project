import debug from 'debug';

import { MessageModel } from '@/database/models/message';
import { FileService } from '@/server/services/file';

import { dispatchOpenSandboxTool } from './handlers';
import { ensureTopicSandboxFiles } from './ensureTopicSandboxFiles';
import {
  type OpenSandboxDeps,
  type OpenSandboxRunBuildInTool,
  type RunBuildInToolContext,
} from './types';

const log = debug('lobe-server:open-sandbox-dispatcher');

export function createOpenSandboxRunBuildInTool(deps: OpenSandboxDeps): OpenSandboxRunBuildInTool {
  return async (toolName, params, context?: RunBuildInToolContext) => {
    const sessionId = context?.topicId ?? context?.userId ?? 'default';
    const client = deps.getSandboxClient();

    if (context?.topicId && context?.userId && deps.serverDB) {
      try {
        const fileService = new FileService(deps.serverDB, context.userId);
        const messageModel = new MessageModel(deps.serverDB, context.userId);
        await ensureTopicSandboxFiles({
          fileService,
          messageModel,
          sandboxClient: client,
          topicId: context.topicId,
        });
      } catch (error) {
        log('ensureTopicSandboxFiles failed topicId=%s: %O', context.topicId, error);
      }
    }

    log('runBuildInTool: toolName=%s, sessionId=%s', toolName, sessionId);

    return dispatchOpenSandboxTool({
      client,
      params: params ?? {},
      sessionId,
      toolName,
    });
  };
}
