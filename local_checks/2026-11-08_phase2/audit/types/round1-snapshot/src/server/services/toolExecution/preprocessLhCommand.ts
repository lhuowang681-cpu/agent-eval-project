import debug from 'debug';

import { appEnv } from '@/envs/app';
import { signUserJWT } from '@/libs/trpc/utils/internalJwt';
import { isDev } from '@/utils/env';

const log = debug('lobe-server:lh-command');

export interface PreprocessResult {
  command: string;
  error?: string;
  isLhCommand: boolean;
  skipSkillLookup: boolean;
}

/**
 * Detect and preprocess `lh` CLI commands.
 * - Replaces `lh` with `npx -y @ctrip/tripyoyo-cli`
 * - Injects TRIPYOYO_JWT and TRIPYOYO_SERVER env vars
 * - Signals caller to skip skill DB lookup
 */
export const preprocessLhCommand = async (
  command: string,
  userId: string,
): Promise<PreprocessResult> => {
  // Match `lh` at the start of the command or after shell operators (&&, ||, ;)
  const lhPattern = /(?:^|&&|\|\||;)\s*lh(?:\s|$)/;
  const isLhCommand = lhPattern.test(command);

  if (!isLhCommand) {
    return { command, isLhCommand: false, skipSkillLookup: false };
  }

  try {
    const jwt = await signUserJWT(userId);

    // In dev the sandbox runs remotely and can't reach localhost, so point the CLI
    // at the cloud/test server instead of appEnv.APP_URL (= http://localhost:3010).
    // Use fat0 to match this dev env's OFFICIAL_CLOUD_SERVER / gateway config and the
    // desktop CliCtr path (both resolve cloud to fat0), so both `lh` routes hit the
    // same backend in dev.
    const serverUrl = isDev ? 'https://calcifer.fat0.tripqate.com' : appEnv.APP_URL;

    const envPrefix = `TRIPYOYO_JWT=${jwt} TRIPYOYO_SERVER=${serverUrl}`;

    // Replace `lh` in all sub-commands separated by &&, ||, or ;
    const rewritten = command.replaceAll(
      /(^|&&|\|\||;)(\s*)lh(\s|$)/g,
      `$1$2${envPrefix} npx -y @ctrip/tripyoyo-cli$3`,
    );
    const finalCommand = rewritten;

    log(
      'Intercepted lh command for user %s, rewritten to: %s',
      userId,
      finalCommand.replace(jwt, '<redacted>'),
    );

    return { command: finalCommand, isLhCommand: true, skipSkillLookup: true };
  } catch (error) {
    log('Failed to sign user JWT for lh command: %O', error);
    return {
      command,
      error: 'Failed to authenticate for CLI execution',
      isLhCommand: true,
      skipSkillLookup: true,
    };
  }
};
