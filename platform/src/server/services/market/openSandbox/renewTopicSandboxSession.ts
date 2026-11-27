import debug from 'debug';

import { createSandboxClientFromEnv, type SandboxToolClient } from '../sandboxToolClient';

const log = debug('lobe-server:renew-topic-sandbox-session');

export interface RenewTopicSandboxSessionParams {
  sandboxClient?: SandboxToolClient;
  topicId: string;
}

/**
 * 若 topic 对应沙箱仍存在且未过期，则向 OpenSandbox 续期。
 * 用于用户在同 topic 继续聊天时延长沙箱生命周期。
 */
export async function renewTopicSandboxSession({
  topicId,
  sandboxClient = createSandboxClientFromEnv(),
}: RenewTopicSandboxSessionParams): Promise<boolean> {
  try {
    const renewed = await sandboxClient.renewSessionIfActive(topicId);

    if (renewed) {
      log('Renewed sandbox session for topicId=%s', topicId);
    }

    return renewed;
  } catch (error) {
    log('renewTopicSandboxSession failed for topicId=%s: %O', topicId, error);
    return false;
  }
}
