import { LocalSystemApiName, LocalSystemIdentifier } from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// `@lobechat/builtin-skills` transitively imports `.md` skill bodies which the
// test bundler can't parse; the device-routing path never touches builtinSkills,
// so stub the module to keep the suite loadable.
vi.mock('@lobechat/builtin-skills', () => ({
  FeishuCliIdentifier: 'feishu-cli',
  OpenCliIdentifier: 'opencli',
  SANDBOX_BUILTIN_SKILL_IDENTIFIERS: new Set<string>(),
  TripYoYoIdentifier: 'tripyoyo',
  builtinSkills: [],
}));

// Mock deviceProxy before importing the service under test
const mockExecuteToolCall = vi.fn();
vi.mock('../../deviceProxy', () => ({
  deviceProxy: {
    executeToolCall: (...args: any[]) => mockExecuteToolCall(...args),
  },
}));

const { SkillServerRuntimeService } = await import('../skills');

// Device-path execScript/runCommand return before touching the DB/market deps,
// so dummy services are enough for these cases.
const makeService = (
  activeDeviceId?: string,
  overrides?: {
    skillModel?: any;
    topicId?: string;
  },
) =>
  new SkillServerRuntimeService({
    activeDeviceId,
    fileModel: {} as any,
    fileService: {} as any,
    marketService: {} as any,
    resourceService: {} as any,
    skillModel: overrides?.skillModel ?? ({} as any),
    topicId: overrides?.topicId,
    userId: 'user-1',
  });

describe('SkillServerRuntimeService — device routing', () => {
  beforeEach(() => mockExecuteToolCall.mockReset());

  it('routes execScript to the device local-system runCommand when a device is active', async () => {
    mockExecuteToolCall.mockResolvedValue({ content: 'open_id: ou_123', success: true });
    const service = makeService('device-a');

    const result = await service.execScript('lark-cli auth status', {
      description: 'check feishu login',
    } as any);

    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      { deviceId: 'device-a', userId: 'user-1' },
      {
        apiName: LocalSystemApiName.runCommand,
        arguments: JSON.stringify({
          command: 'lark-cli auth status',
          description: 'check feishu login',
        }),
        identifier: LocalSystemIdentifier,
      },
      120_000,
    );
    expect(result).toEqual({
      exitCode: 0,
      output: 'open_id: ou_123',
      stderr: '',
      success: true,
    });
  });

  it('routes runCommand to the device and maps a failure to a non-zero exit + stderr', async () => {
    mockExecuteToolCall.mockResolvedValue({
      content: '',
      error: 'command not found: lark-cli',
      success: false,
    });
    const service = makeService('device-a');

    const result = await service.runCommand({ command: 'lark-cli im send' });

    expect(mockExecuteToolCall).toHaveBeenCalledWith(
      { deviceId: 'device-a', userId: 'user-1' },
      expect.objectContaining({
        apiName: LocalSystemApiName.runCommand,
        identifier: LocalSystemIdentifier,
      }),
      120_000,
    );
    expect(result).toEqual({
      exitCode: 1,
      output: '',
      stderr: 'command not found: lark-cli',
      success: false,
    });
  });

  it('does NOT route to the device when no device is active (falls through to the cloud path)', async () => {
    const service = makeService(undefined);

    // Without a device and without a topicId, the cloud path guards on topicId —
    // proving the run did not take the device branch.
    await expect(
      service.execScript('lark-cli auth status', { description: 'x' } as any),
    ).rejects.toThrow('topicId is required for execScript');
    expect(mockExecuteToolCall).not.toHaveBeenCalled();
  });

  it('filters desktop-only skills from cloud findAll but allows them on device path', async () => {
    const safeSkill = { id: 'safe', name: 'Safe', webSafeScanPassed: true };
    const desktopOnlySkill = { id: 'desktop-only', name: 'Desktop Only', webSafeScanPassed: false };
    const skillModel = {
      findAll: vi.fn().mockResolvedValue({
        data: [safeSkill, desktopOnlySkill],
        total: 2,
      }),
    };

    const cloudService = makeService(undefined, { skillModel });
    const cloudResult = await cloudService.findAll();
    expect(cloudResult).toEqual({ data: [safeSkill], total: 1 });

    const deviceService = makeService('device-a', { skillModel });
    const deviceResult = await deviceService.findAll();
    expect(deviceResult).toEqual({ data: [safeSkill, desktopOnlySkill], total: 2 });
  });

  it('rejects desktop-only skill execution in cloud runtime', async () => {
    const skillModel = {
      findAll: vi.fn(),
      findByName: vi.fn().mockResolvedValue({
        id: 'desktop-only',
        name: 'Desktop Only',
        webSafeScanPassed: false,
      }),
    };
    const service = makeService(undefined, { skillModel, topicId: 'topic-1' });

    const result = await service.execScript('echo unsafe', {
      config: { name: 'Desktop Only' },
      description: 'run desktop-only skill',
    });

    expect(result.success).toBe(false);
    expect(result.stderr).toContain('has not passed security scan');
  });
});
