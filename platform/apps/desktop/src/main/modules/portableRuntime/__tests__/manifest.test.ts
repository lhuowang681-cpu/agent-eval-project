import { describe, expect, it, vi } from 'vitest';

import {
  ALLOWED_DOWNLOAD_HOSTS,
  assertAllowedHost,
  getPlatformKey,
  resolveRuntime,
  RUNTIME_MANIFEST,
  UnsupportedPlatformError,
} from '../manifest';

describe('manifest', () => {
  describe('RUNTIME_MANIFEST', () => {
    it('has node and python entries with 4 platforms each', () => {
      expect(RUNTIME_MANIFEST.node.version).toBe('24.14.0');
      expect(RUNTIME_MANIFEST.python.version).toBe('3.12.13');
      const nodePlatforms = Object.keys(RUNTIME_MANIFEST.node.platforms);
      const pythonPlatforms = Object.keys(RUNTIME_MANIFEST.python.platforms);
      expect(nodePlatforms.sort()).toEqual([
        'darwin-arm64',
        'darwin-x64',
        'win32-arm64',
        'win32-x64',
      ]);
      expect(pythonPlatforms.sort()).toEqual([
        'darwin-arm64',
        'darwin-x64',
        'win32-arm64',
        'win32-x64',
      ]);
    });

    it('python entries all have hardcoded sha256', () => {
      for (const p of Object.values(RUNTIME_MANIFEST.python.platforms)) {
        expect(p!.sha256).toMatch(/^[0-9a-f]{64}$/);
      }
    });

    it('node entries have archiveName for SHASUMS lookup', () => {
      for (const p of Object.values(RUNTIME_MANIFEST.node.platforms)) {
        expect(p!.archiveName).toBeTruthy();
      }
    });

    it('all URLs use allowed hosts', () => {
      const collect = (entry: any) => Object.values(entry.platforms).map((p: any) => p.url);
      const urls = [
        ...collect(RUNTIME_MANIFEST.node),
        ...collect(RUNTIME_MANIFEST.python),
        RUNTIME_MANIFEST.node.shasumsUrl!,
      ];
      for (const url of urls) {
        expect(ALLOWED_DOWNLOAD_HOSTS.has(new URL(url).hostname)).toBe(true);
      }
    });
  });

  describe('getPlatformKey', () => {
    it('returns darwin-arm64 for macOS ARM', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
      expect(getPlatformKey()).toBe('darwin-arm64');
    });

    it('returns win32-x64 for Windows x64', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
      expect(getPlatformKey()).toBe('win32-x64');
    });

    it('throws on Linux', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
      expect(() => getPlatformKey()).toThrow(UnsupportedPlatformError);
    });
  });

  describe('resolveRuntime', () => {
    it('returns platform entry for supported platform', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('arm64');
      const { entry, platform } = resolveRuntime('python');
      expect(entry.version).toBe('3.12.13');
      expect(platform.sha256).toBeTruthy();
      expect(platform.format).toBe('tar.gz');
    });

    it('throws on unsupported platform', () => {
      vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
      vi.spyOn(process, 'arch', 'get').mockReturnValue('x64');
      expect(() => resolveRuntime('node')).toThrow(UnsupportedPlatformError);
    });
  });

  describe('assertAllowedHost', () => {
    it('accepts whitelisted host', () => {
      expect(() => assertAllowedHost('https://docs.c-ctrip.com/files/8/foo.tar.gz')).not.toThrow();
    });

    it('rejects unknown host', () => {
      expect(() => assertAllowedHost('https://evil.example.com/x')).toThrow(
        /Disallowed download host/,
      );
    });

    it('rejects non-http protocols', () => {
      expect(() => assertAllowedHost('file:///etc/passwd')).toThrow();
    });
  });
});
