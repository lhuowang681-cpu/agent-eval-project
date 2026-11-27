// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * 架构护栏 —— packages/* 不得**新增**对应用侧 `@/` 的反向依赖。
 *
 * 现状（2026-08-09 实测）：25 个包、269 处反向 import。它使这些包无法脱离应用
 * 独立构建与测试 —— 阶段 4 就撞到过：`web-crawler` 报
 * `Cannot find package '@/auth' imported from packages/utils/src/server/auth.ts`。
 *
 * ⚠️ 本用例**不是**要修复存量，而是**冻结存量**。
 *
 * 存量修不了的原因是它集中在两处架构性依赖上（占 67%）：
 *   · `@/styles`（93 处）—— builtin-tool 包的 Inspector 是 React UI，消费应用的设计令牌
 *   · `@/store/*`（88 处）—— 同样是这些 UI 直接读应用的 zustand store
 * 真正的解法是「把设计系统抽成包」+「store 访问反转为注入」，属产品级架构决策；
 * 只改零散的那 88 处而留下 181 处，循环依赖依旧存在、包依旧无法独立测试 ——
 * 收益为零，却要在 25 个包里承担回归风险。
 *
 * 判定口径：`@/database` / `@/const` / `@/utils` / `@/types` 在 tsconfig 里
 * 映射到 `packages/`，属**包与包之间**的正常依赖，不计入反向依赖。
 *
 * 断言方向刻意设计成「改进永远通过、退化必然失败」：
 *   · 出现基线之外的新包 → 失败
 *   · 总处数超过基线 → 失败
 *   · 修好了（包变少 / 处数下降）→ 通过，并可顺手下调基线
 */

const REPO_ROOT = path.resolve(__dirname, '../..');
const PACKAGES_DIR = path.join(REPO_ROOT, 'packages');

/** 这些 `@/` 前缀在 tsconfig 里指向 packages/，不是反向依赖 */
const PACKAGE_ALIASED = ['@/database/', '@/const/', '@/utils/', '@/types/'];

const SOURCE_EXT = new Set(['.ts', '.tsx']);

/** 当前存量基线 —— 只允许下降，不允许上升 */
const BASELINE_PACKAGES = [
  'agent-manager-runtime',
  'builtin-tool-activator',
  'builtin-tool-agent-builder',
  'builtin-tool-agent-documents',
  'builtin-tool-agent-management',
  'builtin-tool-cloud-sandbox',
  'builtin-tool-group-agent-builder',
  'builtin-tool-group-management',
  'builtin-tool-knowledge-base',
  'builtin-tool-lobe-agent',
  'builtin-tool-local-system',
  'builtin-tool-memory',
  'builtin-tool-notebook',
  'builtin-tool-page-agent',
  'builtin-tool-skill-store',
  'builtin-tool-skills',
  'builtin-tool-task',
  'builtin-tool-tools',
  'builtin-tool-topic-reference',
  'builtin-tool-web-browsing',
  'database',
  'edge-config',
  'openapi',
  'types',
  'utils',
];

/**
 * 273 而非人工 grep 得到的 269：本用例额外统计了 `await import('@/…')` 的动态导入。
 * 动态导入同样构成反向依赖（打包时照样要解析到应用侧），只是 grep `from '@/'` 抓不到 ——
 * 以本用例的测量为准。
 */
const BASELINE_TOTAL = 273;

const walk = (dir: string, out: string[] = []): string[] => {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      walk(full, out);
    } else if (SOURCE_EXT.has(path.extname(entry.name)) && !/\.(test|spec)\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
};

const collectReverseDeps = (): { byPackage: Map<string, number>; total: number } => {
  const byPackage = new Map<string, number>();
  let total = 0;

  const packages = fs
    .readdirSync(PACKAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory());

  for (const pkg of packages) {
    const srcDir = path.join(PACKAGES_DIR, pkg.name, 'src');
    if (!fs.existsSync(srcDir)) continue;

    let count = 0;
    for (const file of walk(srcDir)) {
      const content = fs.readFileSync(file, 'utf8');
      /*
       * 四种写法都要覆盖，缺一不可：
       *   1. `from '@/x'`        —— 静态具名/默认导入
       *   2. `import('@/x')`     —— 动态导入
       *   3. `import '@/x'`      —— **副作用导入**（无 from），最容易漏
       *   4. `require('@/x')`    —— CJS
       * 本护栏初版只写了 1、2，实测往包里塞一行 `import '@/styles';` 竟然抓不到 ——
       * 而副作用导入恰恰是引入设计令牌/样式最常见的形式。
       */
      const patterns =
        /from\s+'(@\/[^']+)'|import\s*\(\s*'(@\/[^']+)'\s*\)|import\s+'(@\/[^']+)'|require\s*\(\s*'(@\/[^']+)'\s*\)/g;

      for (const m of content.matchAll(patterns)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
        if (!spec) continue;
        if (PACKAGE_ALIASED.some((prefix) => spec.startsWith(prefix))) continue;
        count++;
      }
    }

    if (count > 0) {
      byPackage.set(pkg.name, count);
      total += count;
    }
  }

  return { byPackage, total };
};

describe('packages 对应用侧 @/ 的反向依赖', () => {
  const { byPackage, total } = collectReverseDeps();

  it('不得出现基线之外的新包', () => {
    const offenders = [...byPackage.keys()].sort();
    const newcomers = offenders.filter((p) => !BASELINE_PACKAGES.includes(p));

    /*
     * 若失败：说明有包新引入了 `@/styles`、`@/store/*`、`@/features/*` 这类应用侧导入。
     * 请改为：所需数据由调用方以 props / 参数传入，或把公共部分下沉到 packages/。
     * 不要通过扩大本基线来"修复"。
     */
    expect(newcomers).toEqual([]);
  });

  it('反向依赖总处数不得超过基线', () => {
    expect(total).toBeLessThanOrEqual(BASELINE_TOTAL);
  });

  it('存量分布可被观测（记录用，不作阈值）', () => {
    // 断言一个宽松下界即可：这条的价值是让失败时的输出带上现场分布，
    // 而不是把某个精确数字钉死成新的维护负担。
    expect(byPackage.size).toBeGreaterThan(0);
    expect(byPackage.size).toBeLessThanOrEqual(BASELINE_PACKAGES.length);
  });
});
