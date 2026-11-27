/**
 * Central SWR key registry (device domain).
 *
 * The first array element is `'<domain>:<resource>'`, followed by parameters.
 * The `domain:` prefix lets callers refresh a whole domain at once. Each factory
 * also exposes `.root` (the namespace string) for `mutate` matchers that compare
 * `key[0]`.
 */

type KeyFactory<A extends unknown[]> = ((...args: A) => readonly unknown[]) & { root: string };

/** Define a key factory carrying its namespace root (for `mutate` matchers). */
const def = <A extends unknown[]>(
  root: string,
  build: (...args: A) => readonly unknown[],
): KeyFactory<A> => Object.assign(build, { root });

export const electronKeys = {
  gatewayDeviceInfo: def('electron:getGatewayDeviceInfo', () => ['electron:getGatewayDeviceInfo']),
};

export const topicKeys = {
  agentView: def('topic:agentView', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:agentView',
    containerKey,
    opts,
  ]),
  list: def('topic:list', (containerKey: string, opts: Record<string, unknown>) => [
    'topic:list',
    containerKey,
    opts,
  ]),
  search: def('topic:search', (keywords: string, agentId?: string, groupId?: string) => [
    'topic:search',
    keywords,
    agentId,
    groupId,
  ]),
};

export const deviceKeys = {
  gitAheadBehind: def('device:gitAheadBehind', (deviceId: string, path: string) => [
    'device:gitAheadBehind',
    deviceId,
    path,
  ]),
  gitBranches: def('device:gitBranches', (deviceId: string, path: string) => [
    'device:gitBranches',
    deviceId,
    path,
  ]),
  gitInfo: def('device:gitInfo', (deviceId: string, path: string, isGithub: boolean) => [
    'device:gitInfo',
    deviceId,
    path,
    isGithub,
  ]),
  gitRemoteBranches: def('device:gitRemoteBranches', (deviceId: string, dirPath: string) => [
    'device:gitRemoteBranches',
    deviceId,
    dirPath,
  ]),
  gitReviewPatches: def(
    'device:gitReviewPatches',
    (deviceId: string, dirPath: string, mode: string, baseRef: string) => [
      'device:gitReviewPatches',
      deviceId,
      dirPath,
      mode,
      baseRef,
    ],
  ),
  gitWorkingTreeStatus: def('device:gitWorkingTreeStatus', (deviceId: string, path: string) => [
    'device:gitWorkingTreeStatus',
    deviceId,
    path,
  ]),
  listDevices: def('device:listDevices', () => ['device:listDevices']),
  repoType: def('device:repoType', (path: string) => ['device:repoType', path]),
};
