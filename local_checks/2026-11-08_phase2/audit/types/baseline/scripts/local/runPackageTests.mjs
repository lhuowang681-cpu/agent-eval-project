#!/usr/bin/env node
/**
 * L1 批量跑各 package 的 Vitest，逐包汇总 —— 阶段 5 的 L1 层补齐.
 *
 * 为什么需要这个脚本：
 *   1. 根 `vitest.config.mts` 的 `exclude` 含 `**\/packages/**`，所以从仓库根跑不到
 *      任何包内测试，必须**进入包目录**单独运行（05-functional-report.md §1 已记录）。
 *   2. CLAUDE.md 明令禁止 `bun run test`（全量约 10 分钟）。逐包跑既符合约束，
 *      又能定位到是哪个包坏了。
 *   3. `packages/debug` 强制开启 `lobe-*` 命名空间且无法用 DEBUG 关掉，
 *      输出会被调试日志淹没 —— 这里把 stdout 落盘再提取摘要。
 *
 * 用法：
 *   node scripts/local/runPackageTests.mjs                  # 跑全部有测试的包
 *   node scripts/local/runPackageTests.mjs --only database,utils
 *   node scripts/local/runPackageTests.mjs --skip model-runtime
 *   node scripts/local/runPackageTests.mjs --timeout 600000
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '..', '..');
const packagesDir = join(repoRoot, 'packages');
const outDir = join(repoRoot, '.test-logs');

const argv = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i > -1 ? argv[i + 1] : fallback;
};
const only = opt('--only', '').split(',').filter(Boolean);
const skip = opt('--skip', '').split(',').filter(Boolean);
const timeout = Number(opt('--timeout', '900000'));

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

/** Locate bun.exe: it may not be on PATH depending on how it was installed. */
const resolveBun = () => {
  const fromEnv = process.env.BUN_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;

  const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['bun'], {
    encoding: 'utf8',
  });
  const found = (probe.stdout ?? '').split(/\r?\n/).find((l) => l.trim().endsWith('bun.exe') || l.trim().endsWith('/bun'));
  if (found && existsSync(found.trim())) return found.trim();

  const winget = join(
    process.env.LOCALAPPDATA ?? '',
    'Microsoft/WinGet/Packages/Oven-sh.Bun_Microsoft.Winget.Source_8wekyb3d8bbwe/bun-windows-x64/bun.exe',
  );
  if (existsSync(winget)) return winget;

  throw new Error('找不到 bun 可执行文件，请设置 BUN_PATH 环境变量');
};

const bunPath = resolveBun();
console.info(`bun: ${bunPath}`);

/** Count *.test.ts under a directory, ignoring node_modules. */
const countTests = (dir) => {
  let n = 0;
  const walk = (d) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.test.ts') || e.name.endsWith('.test.tsx')) n++;
    }
  };
  walk(dir);
  return n;
};

const candidates = readdirSync(packagesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .filter((name) => {
    if (only.length && !only.includes(name)) return false;
    if (skip.includes(name)) return false;
    const dir = join(packagesDir, name);
    if (!existsSync(join(dir, 'package.json'))) return false;
    return countTests(dir) > 0;
  });

console.info(`\n将运行 ${candidates.length} 个包的测试，日志落在 .test-logs/\n`);

/**
 * Vitest prints a summary line like:
 *   Tests  253 passed | 4 failed (257)
 *   Test Files  8 passed | 1 failed (9)
 * Parse both so a package that fails to even start is distinguishable from one
 * whose tests ran and failed.
 */
const parseSummary = (text) => {
  const clean = text.replace(/\[[0-9;]*[A-Za-z]/g, '');
  const files = clean.match(/Test Files\s+(.+)/)?.[1]?.trim();
  const tests = clean.match(/Tests\s+(.+)/)?.[1]?.trim();
  const noTests = /No test files found/i.test(clean);
  return { files, noTests, tests };
};

const results = [];

for (const [i, name] of candidates.entries()) {
  const dir = join(packagesDir, name);
  const nFiles = countTests(dir);
  process.stdout.write(`[${i + 1}/${candidates.length}] ${name} (${nFiles} 个测试文件) … `);

  const started = Date.now();
  // `bun x` rather than `bunx`: the WinGet bun package ships only bun.exe, so a
  // bare `bunx` is not on PATH on this machine.
  const res = spawnSync(
    bunPath,
    ['x', 'vitest', 'run', '--silent=passed-only', '--reporter=default'],
    { cwd: dir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout },
  );

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const out = `${res.stdout ?? ''}\n${res.stderr ?? ''}`;
  writeFileSync(join(outDir, `${name}.log`), out, 'utf8');

  const parsed = parseSummary(out);
  const timedOut = res.error?.code === 'ETIMEDOUT';
  const status = timedOut ? 'TIMEOUT' : parsed.noTests ? 'NO-TESTS' : res.status === 0 ? 'PASS' : 'FAIL';

  results.push({ elapsed, files: parsed.files, name, nFiles, status, tests: parsed.tests });
  console.info(`${status} (${elapsed}s) ${parsed.tests ?? ''}`);
}

console.info('\n' + '═'.repeat(78));
console.info('L1 逐包结果');
console.info('═'.repeat(78));
console.info('包'.padEnd(32) + '文件'.padEnd(6) + '状态'.padEnd(10) + '用例');
console.info('─'.repeat(78));
for (const r of results) {
  console.info(
    r.name.padEnd(32) + String(r.nFiles).padEnd(6) + r.status.padEnd(10) + (r.tests ?? r.files ?? ''),
  );
}

const tally = results.reduce((a, r) => ({ ...a, [r.status]: (a[r.status] ?? 0) + 1 }), {});
console.info('─'.repeat(78));
console.info(
  `合计 ${results.length} 个包： ` +
    Object.entries(tally)
      .map(([k, v]) => `${k} ${v}`)
      .join(' / '),
);

const failed = results.filter((r) => r.status === 'FAIL' || r.status === 'TIMEOUT');
if (failed.length) {
  console.info('\n失败/超时的包（详情见 .test-logs/<包名>.log）：');
  for (const r of failed) console.info(`  - ${r.name}  ${r.tests ?? ''}`);
}

writeFileSync(join(outDir, 'summary.json'), JSON.stringify(results, null, 2), 'utf8');
console.info(`\n汇总已写入 .test-logs/summary.json\n`);
