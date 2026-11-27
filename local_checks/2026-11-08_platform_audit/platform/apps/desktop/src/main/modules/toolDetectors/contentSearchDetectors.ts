import type { IToolDetector } from '@/core/infrastructure/ToolDetectorManager';
import { createCommandDetector } from '@/core/infrastructure/ToolDetectorManager';

import { createPortableFirstDetector } from './runtimeEnvironmentDetectors';

/**
 * Content search tool detectors
 *
 * Priority order: rg (1) > grep (3)
 * AST search: sg (ast-grep) - separate category for AST-based code search
 *
 * ag(the_silver_searcher) 已从列表移除:rg 已完全上位替代且 Windows 分发不可靠。
 */

/**
 * ripgrep (rg) - Fastest grep alternative — portable-first, then system fallback.
 * https://github.com/BurntSushi/ripgrep
 */
export const ripgrepDetector: IToolDetector = createPortableFirstDetector('rg', 'rg', {
  description: 'ripgrep - fast grep alternative',
  priority: 1,
});

/**
 * ast-grep (sg) - AST-based code search tool
 * https://ast-grep.github.io/
 */
export const astGrepDetector: IToolDetector = createCommandDetector('sg', {
  description: 'ast-grep - AST-based code search',
  priority: 1,
});

/**
 * GNU grep - Standard text search tool.
 * Windows 上无原生 grep(需 WSL/Git Bash),标记为「当前平台不支持」而非提供无效的安装按钮。
 */
export const grepDetector: IToolDetector = {
  description: 'GNU grep',
  async detect() {
    if (process.platform === 'win32') {
      return { available: false, supportedOnCurrentPlatform: false };
    }
    return createCommandDetector('grep', { description: 'GNU grep' }).detect();
  },
  name: 'grep',
  priority: 3,
};

/**
 * All content search detectors (text-based grep tools)
 */
export const contentSearchDetectors: IToolDetector[] = [ripgrepDetector, grepDetector];

/**
 * AST-based code search detectors
 */
export const astSearchDetectors: IToolDetector[] = [astGrepDetector];
