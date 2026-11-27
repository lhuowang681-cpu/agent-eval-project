import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system';

import { deviceProxy } from '../deviceProxy';
import { type ServerRuntimeRegistration } from './types';

const WORKING_DIR_ARG: Partial<Record<string, 'cwd' | 'scope'>> = {
  [LocalSystemApiName.editLocalFile]: 'cwd',
  [LocalSystemApiName.globLocalFiles]: 'scope',
  [LocalSystemApiName.grepContent]: 'scope',
  [LocalSystemApiName.listLocalFiles]: 'cwd',
  [LocalSystemApiName.moveLocalFiles]: 'cwd',
  [LocalSystemApiName.readLocalFile]: 'cwd',
  [LocalSystemApiName.runCommand]: 'cwd',
  [LocalSystemApiName.searchLocalFiles]: 'scope',
  [LocalSystemApiName.writeLocalFile]: 'cwd',
};

const getArgsWithWorkingDirectory = (
  args: any,
  workingDirArg: 'cwd' | 'scope' | undefined,
  workingDirectory: string | undefined,
) => {
  if (!workingDirArg || !workingDirectory) return args;

  if (args?.[workingDirArg] == null) {
    return { ...args, [workingDirArg]: workingDirectory };
  }

  if (workingDirArg === 'scope' && args?.cwd == null) {
    return { ...args, cwd: workingDirectory };
  }

  return args;
};

export const localSystemRuntime: ServerRuntimeRegistration = {
  factory: (context) => {
    if (!context.userId) {
      throw new Error('userId is required for Local System device proxy execution');
    }
    if (!context.activeDeviceId) {
      throw new Error('activeDeviceId is required for Local System device proxy execution');
    }

    const proxy: Record<string, (args: any) => Promise<any>> = {};

    for (const api of LocalSystemManifest.api) {
      const workingDirArg = WORKING_DIR_ARG[api.name];
      proxy[api.name] = async (args: any) => {
        const finalArgs = getArgsWithWorkingDirectory(
          args,
          workingDirArg,
          context.workingDirectory,
        );

        return deviceProxy.executeToolCall(
          { deviceId: context.activeDeviceId!, userId: context.userId! },
          {
            apiName: api.name,
            arguments: JSON.stringify(finalArgs),
            identifier: LocalSystemIdentifier,
          },
        );
      };
    }

    return proxy;
  },
  identifier: LocalSystemIdentifier,
};
