import { exec } from 'node:child_process';
import { promisify } from 'node:util';

import type { IToolDetector, ToolStatus } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

import { createPortableFirstDetector } from './runtimeEnvironmentDetectors';

const execPromise = promisify(exec);

/**
 * File search tool detectors
 *
 * Priority order: mdfind (1, macOS) > fd (2) > find (3)
 */

/**
 * mdfind - macOS Spotlight search
 * Only available on macOS, uses Spotlight index for fast searching
 */
export const mdfindDetector: IToolDetector = {
  description: 'macOS Spotlight search',
  async detect(): Promise<ToolStatus> {
    // Only available on macOS
    if (process.platform !== 'darwin') {
      return {
        available: false,
        error: 'mdfind is only available on macOS',
        supportedOnCurrentPlatform: false,
      };
    }

    try {
      // Check if mdfind command exists and Spotlight is working.
      // `-count` must precede the query expression; otherwise mdfind treats it
      // as part of the query and prints matching paths instead of a count.
      const { stdout } = await execPromise('mdfind -count -name test -onlyin ~', {
        timeout: 5000,
      });

      // If mdfind returns a number (even 0), Spotlight is available
      const count = parseInt(stdout.trim(), 10);
      if (Number.isNaN(count)) {
        return {
          available: false,
          error: 'Spotlight returned invalid response',
        };
      }

      return {
        available: true,
        path: '/usr/bin/mdfind',
      };
    } catch (error) {
      return {
        available: false,
        error: (error as Error).message,
      };
    }
  },
  name: 'mdfind',
  priority: 1,
};

/**
 * fd - Fast alternative to find — portable-first, then system fallback.
 * https://github.com/sharkdp/fd
 */
export const fdDetector: IToolDetector = createPortableFirstDetector('fd', 'fd', {
  description: 'fd - fast find alternative',
  priority: 2,
});

/**
 * find - Standard Unix file search.
 * Windows 上无原生 find (系统的 find.exe 语义完全不同),标记为「当前平台不支持」。
 */
export const findDetector: IToolDetector = {
  description: 'Unix find command',
  async detect() {
    if (process.platform === 'win32') {
      return { available: false, supportedOnCurrentPlatform: false };
    }
    return createCommandDetector('find', {
      description: 'Unix find command',
      versionFlag: '--version', // GNU find supports this
    }).detect();
  },
  name: 'find',
  priority: 3,
};

/**
 * All file search detectors
 */
export const fileSearchDetectors: IToolDetector[] = [mdfindDetector, fdDetector, findDetector];
