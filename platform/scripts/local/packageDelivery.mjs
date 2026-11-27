#!/usr/bin/env node
/**
 * Package the analysis deliverables into a standalone folder + zip.
 *
 * Run after any report update so the folder and the archive never drift from the
 * repo. Both live outside the repo (the git root is one level above the project
 * dir, so anything inside would show up as untracked noise).
 *
 * Usage:  node scripts/local/packageDelivery.mjs
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repo = resolve(__dirname, '..', '..');
const outDir = resolve(repo, '..', '..', 'calcifer-analysis-delivery');
const zipPath = `${outDir}-${new Date().toISOString().slice(0, 10)}.zip`;

/** [source relative to repo, destination relative to outDir] */
const items = [
  ['PLAN.md', 'PLAN.md'],
  ['.env.offline.example', '.env.offline.example'],
  ['REPORT.perf.md', 'reports/REPORT.perf.md'],
  ['REPORT.analysis.md', 'reports/REPORT.analysis.md'],
  ['docs/analysis', 'docs'],
  ['tools/api-test', 'tools/api-test'],
  ['tools/mock-llm', 'tools/mock-llm'],
  ['tools/mock-services', 'tools/mock-services'],
  ['bench', 'bench'],
  ['stubs', 'stubs'],
];

const localScripts = ['pgliteServer.ts', 'seedDevUser.ts', 'setupOfflineMocks.mjs', 'packageDelivery.mjs'];

const countFiles = (dir) => {
  let n = 0;
  let bytes = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        n += 1;
        bytes += statSync(p).size;
      }
    }
  };
  walk(dir);
  return { bytes, n };
};

// The delivery folder is fully regenerated each run so deletions propagate.
// Guarded: only ever touches the dedicated output directory.
if (existsSync(outDir)) {
  if (!outDir.endsWith('calcifer-analysis-delivery')) {
    throw new Error(`拒绝删除非交付目录: ${outDir}`);
  }
  rmSync(outDir, { force: true, recursive: true });
}
mkdirSync(outDir, { recursive: true });

for (const [from, to] of items) {
  const src = join(repo, from);
  if (!existsSync(src)) {
    console.warn(`  ⚠ 跳过（不存在）: ${from}`);
    continue;
  }
  const dst = join(outDir, to);
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: true });
}

mkdirSync(join(outDir, 'scripts/local'), { recursive: true });
for (const f of localScripts) {
  const src = join(repo, 'scripts/local', f);
  if (existsSync(src)) cpSync(src, join(outDir, 'scripts/local', f));
}

// README.md is authored for the delivery bundle, not copied from the repo.
const readmeSrc = join(repo, 'docs/analysis/DELIVERY-README.md');
if (existsSync(readmeSrc)) cpSync(readmeSrc, join(outDir, 'README.md'));

if (existsSync(zipPath)) rmSync(zipPath, { force: true });
execFileSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Compress-Archive -Path '${outDir}\\*' -DestinationPath '${zipPath}' -CompressionLevel Optimal`],
  { stdio: 'inherit' },
);

const { n, bytes } = countFiles(outDir);
const zipKb = (statSync(zipPath).size / 1024).toFixed(1);

console.info('');
console.info('📁 文件夹  ' + outDir);
console.info(`           ${n} 个文件 / ${(bytes / 1024).toFixed(1)} KB`);
console.info('📦 ZIP     ' + zipPath);
console.info(`           ${zipKb} KB`);
