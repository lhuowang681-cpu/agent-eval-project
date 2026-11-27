import {
  LocalSystemApiName,
  LocalSystemIdentifier,
  LocalSystemManifest,
} from '@lobechat/builtin-tool-local-system';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ToolExecutionContext } from '../../types';

// Mock deviceProxy
const mockExecuteToolCall = vi.fn();
vi.mock('../../deviceProxy', () => ({
  deviceProxy: {
    executeToolCall: (...args: any[]) => mockExecuteToolCall(...args),
  },
}));

// Import after mock setup
const { localSystemRuntime } = await import('../localSystem');

describe('localSystemRuntime', () => {
  beforeEach(() => {
    mockExecuteToolCall.mockClear();
  });

  it('should have the correct identifier', () => {
    expect(localSystemRuntime.identifier).toBe(LocalSystemIdentifier);
  });

  describe('factory', () => {
    it('should throw when userId is missing', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
      };

      expect(() => localSystemRuntime.factory(context)).toThrow(
        'userId is required for Local System device proxy execution',
      );
    });

    it('should throw when activeDeviceId is missing', () => {
      const context: ToolExecutionContext = {
        toolManifestMap: {},
        userId: 'user-1',
      };

      expect(() => localSystemRuntime.factory(context)).toThrow(
        'activeDeviceId is required for Local System device proxy execution',
      );
    });

    it('should create a proxy with a function for each API in LocalSystemManifest', () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const proxy = localSystemRuntime.factory(context);

      for (const api of LocalSystemManifest.api) {
        expect(proxy[api.name]).toBeDefined();
        expect(typeof proxy[api.name]).toBe('function');
      }
    });

    it('should call deviceProxy.executeToolCall with correct arguments when a proxy function is invoked', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
      };

      const expectedResult = { content: 'ok', success: true };
      mockExecuteToolCall.mockResolvedValue(expectedResult);

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;
      const args = { path: '/tmp/test' };

      const result = await proxy[apiName](args);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-1', userId: 'user-1' },
        {
          apiName,
          arguments: JSON.stringify(args),
          identifier: LocalSystemIdentifier,
        },
      );
      expect(result).toEqual(expectedResult);
    });

    it('should JSON.stringify the arguments passed to the proxy function', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-2',
        toolManifestMap: {},
        userId: 'user-2',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const apiName = LocalSystemManifest.api[0].name;
      const complexArgs = { keywords: 'test', fileTypes: ['txt', 'md'], limit: 10 };

      await proxy[apiName](complexArgs);

      expect(mockExecuteToolCall).toHaveBeenCalledWith(
        { deviceId: 'device-2', userId: 'user-2' },
        expect.objectContaining({
          arguments: JSON.stringify(complexArgs),
        }),
      );
    });

    it('should inject workingDirectory as cwd for command and file operations', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/workspace/project',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const cwdApis = [
        LocalSystemApiName.runCommand,
        LocalSystemApiName.readLocalFile,
        LocalSystemApiName.writeLocalFile,
        LocalSystemApiName.editLocalFile,
        LocalSystemApiName.listLocalFiles,
        LocalSystemApiName.moveLocalFiles,
      ];

      for (const apiName of cwdApis) {
        await proxy[apiName]({ path: 'a.txt' });
      }

      for (const call of mockExecuteToolCall.mock.calls) {
        const payload = call[1];
        expect(JSON.parse(payload.arguments)).toMatchObject({ cwd: '/workspace/project' });
      }
    });

    it('should inject workingDirectory as scope for search operations', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/workspace/project',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);
      const scopeApis = [
        LocalSystemApiName.searchLocalFiles,
        LocalSystemApiName.globLocalFiles,
        LocalSystemApiName.grepContent,
      ];

      for (const apiName of scopeApis) {
        await proxy[apiName]({ pattern: 'test' });
      }

      for (const call of mockExecuteToolCall.mock.calls) {
        const payload = call[1];
        expect(JSON.parse(payload.arguments)).toMatchObject({ scope: '/workspace/project' });
      }
    });

    it('should not overwrite explicit cwd or scope arguments', async () => {
      const context: ToolExecutionContext = {
        activeDeviceId: 'device-1',
        toolManifestMap: {},
        userId: 'user-1',
        workingDirectory: '/workspace/project',
      };

      mockExecuteToolCall.mockResolvedValue({ content: '', success: true });

      const proxy = localSystemRuntime.factory(context);

      await proxy[LocalSystemApiName.runCommand]({ command: 'pwd', cwd: '/explicit/cwd' });
      await proxy[LocalSystemApiName.searchLocalFiles]({
        keywords: 'test',
        scope: '/explicit/scope',
      });

      expect(JSON.parse(mockExecuteToolCall.mock.calls[0][1].arguments)).toMatchObject({
        cwd: '/explicit/cwd',
      });
      expect(JSON.parse(mockExecuteToolCall.mock.calls[1][1].arguments)).toMatchObject({
        cwd: '/workspace/project',
        scope: '/explicit/scope',
      });
    });
  });
});
