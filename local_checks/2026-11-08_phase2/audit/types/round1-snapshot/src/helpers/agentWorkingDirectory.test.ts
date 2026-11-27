import { describe, expect, it } from 'vitest';

import { resolveAgentWorkingDirectory } from './agentWorkingDirectory';

describe('resolveAgentWorkingDirectory', () => {
  it('should resolve working directory by precedence', () => {
    const base = {
      agencyConfig: {
        executionTarget: 'local' as const,
        workingDirByDevice: { 'device-1': '/agent-device' },
      },
      currentDeviceId: 'device-1',
      deviceDefaultCwd: '/device-default',
      fallback: '/desktop',
      legacyAgentWorkingDirectory: '/legacy',
      topicWorkingDirectory: '/topic',
    };

    expect(resolveAgentWorkingDirectory(base)).toBe('/topic');
    expect(resolveAgentWorkingDirectory({ ...base, topicWorkingDirectory: undefined })).toBe(
      '/agent-device',
    );
    expect(
      resolveAgentWorkingDirectory({
        ...base,
        agencyConfig: undefined,
        topicWorkingDirectory: undefined,
      }),
    ).toBe('/legacy');
    expect(
      resolveAgentWorkingDirectory({
        ...base,
        agencyConfig: undefined,
        legacyAgentWorkingDirectory: undefined,
        topicWorkingDirectory: undefined,
      }),
    ).toBe('/device-default');
    expect(
      resolveAgentWorkingDirectory({
        ...base,
        agencyConfig: undefined,
        deviceDefaultCwd: undefined,
        legacyAgentWorkingDirectory: undefined,
        topicWorkingDirectory: undefined,
      }),
    ).toBe('/desktop');
  });
});
