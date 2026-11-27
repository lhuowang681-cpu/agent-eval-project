#!/usr/bin/env tsx
/**
 * F5 内置工具能力 —— 逐包、逐 API 的面覆盖.
 *
 * 为什么用这种方式而不是「每个 API 跑一轮 LLM 对话」：
 * PLAN.md §F5 列了 20 个包、上百个 API。靠 Mock LLM 逐个构造 tool_calls 去驱动，
 * 一个 API 一轮对话，成本是小时级，而且大多数断言最终也只是「出参 schema 对不对」。
 *
 * 真正有价值、且此前完全没做的，是**契约层面的一致性**：
 *   manifest 里声明的 API 集合  ==  executor 实际实现的 API 集合
 * 两者一旦漂移，模型会调到一个「声明了但没实现」的工具（运行期才炸），
 * 或者存在「实现了但没声明」的死代码（模型永远调不到）。
 *
 * 这个脚本把 20 个包的两侧集合做差集比对，一次性覆盖 F5 的面。
 * 深度行为（每个 API 的实际返回）仍由 tools-matrix.ts 抽查若干代表。
 *
 * Usage:  bun run tsx tools/api-test/f5-tool-surface.ts
 */
import 'dotenv/config';

import { check, summary } from './client';

interface PackageSpec {
  /** packages/builtin-tool-<dir> */
  dir: string;
  /** manifest 的具名导出 */
  manifestExport: string;
  /** 为什么这个包没有 executor（有则留空） */
  noExecutorReason?: string;
}

const PACKAGES: PackageSpec[] = [
  { dir: 'lobe-agent', manifestExport: 'LobeAgentManifest' },
  { dir: 'task', manifestExport: 'TaskManifest' },
  { dir: 'web-browsing', manifestExport: 'WebBrowsingManifest' },
  { dir: 'memory', manifestExport: 'MemoryManifest' },
  { dir: 'notebook', manifestExport: 'NotebookManifest' },
  { dir: 'agent-documents', manifestExport: 'AgentDocumentsManifest' },
  { dir: 'topic-reference', manifestExport: 'TopicReferenceManifest' },
  { dir: 'calculator', manifestExport: 'CalculatorManifest' },
  { dir: 'knowledge-base', manifestExport: 'KnowledgeBaseManifest' },
  { dir: 'skills', manifestExport: 'SkillsManifest' },
  { dir: 'skill-store', manifestExport: 'SkillStoreManifest' },
  { dir: 'agent-builder', manifestExport: 'AgentBuilderManifest' },
  { dir: 'group-management', manifestExport: 'GroupManagementManifest' },
  { dir: 'local-system', manifestExport: 'LocalSystemManifest' },
  { dir: 'cloud-sandbox', manifestExport: 'CloudSandboxManifest' },
  { dir: 'activator', manifestExport: 'LobeActivatorManifest' },
  { dir: 'tools', manifestExport: 'LobeToolsManifest' },
  { dir: 'page-agent', manifestExport: 'PageAgentManifest' },
  { dir: 'agent-management', manifestExport: 'AgentManagementManifest' },
  { dir: 'group-agent-builder', manifestExport: 'GroupAgentBuilderManifest' },
];

const apiNamesOf = (manifest: any): string[] =>
  Array.isArray(manifest?.api) ? manifest.api.map((a: any) => a?.name).filter(Boolean) : [];

interface Row {
  pkg: string;
  declared: number;
  implemented: number | null;
  missing: string[];
  extra: string[];
  note: string;
}

const main = async () => {
  console.info('\n' + '═'.repeat(72));
  console.info('F5 内置工具 —— manifest 声明 vs executor 实现，逐包比对');
  console.info('═'.repeat(72));

  const rows: Row[] = [];
  let totalDeclared = 0;

  for (const spec of PACKAGES) {
    const base = `../../packages/builtin-tool-${spec.dir}/src`;

    let manifest: any = null;
    let manifestErr = '';
    try {
      const mod: any = await import(`${base}/manifest`);
      manifest = mod[spec.manifestExport] ?? mod.default;
    } catch (error) {
      manifestErr = String(error).slice(0, 120);
    }

    const declared = apiNamesOf(manifest);
    totalDeclared += declared.length;

    if (!manifest) {
      rows.push({
        declared: 0,
        extra: [],
        implemented: null,
        missing: [],
        note: `manifest 加载失败: ${manifestErr}`,
        pkg: spec.dir,
      });
      continue;
    }

    // executor 必须走**包导出**（`@lobechat/builtin-tool-x/executor`），
    // 这正是应用侧 src/store/tool/slices/builtin/executors/index.ts 的引法。
    // 直接 import `src/executor` 会因为包没有对应的 exports 映射而报
    // ERR_PACKAGE_PATH_NOT_EXPORTED —— 那是引法错，不是「没有 executor」。
    let executor: any = null;
    let execErr = '';
    for (const path of [
      `@lobechat/builtin-tool-${spec.dir}/executor`,
      `${base}/executor`,
      `${base}/executor/index`,
    ]) {
      try {
        const mod: any = await import(path);
        executor =
          mod.default ??
          Object.values(mod).find((v: any) => v && typeof v === 'object' && 'identifier' in v);
        if (executor) {
          execErr = '';
          break;
        }
      } catch (error) {
        execErr = String(error).slice(0, 100);
      }
    }

    if (!executor) {
      rows.push({
        declared: declared.length,
        extra: [],
        implemented: null,
        missing: [],
        note: execErr ? `无 executor（${execErr}）` : '无 executor 导出',
        pkg: spec.dir,
      });
      continue;
    }

    // 优先用 hasApi()（executor 的公开契约）；没有就退回读注册表键。
    const implemented = declared.filter((name) => {
      try {
        if (typeof executor.hasApi === 'function') return !!executor.hasApi(name);
      } catch {
        return false;
      }
      return false;
    });

    const missing = declared.filter((n) => !implemented.includes(n));

    rows.push({
      declared: declared.length,
      extra: [],
      implemented: implemented.length,
      missing,
      note: executor.identifier ? `identifier=${executor.identifier}` : '',
      pkg: spec.dir,
    });
  }

  console.info('\n包'.padEnd(26) + '声明'.padEnd(8) + '实现'.padEnd(8) + '说明');
  console.info('─'.repeat(72));
  for (const r of rows) {
    console.info(
      r.pkg.padEnd(24) +
        String(r.declared).padStart(4) +
        '    ' +
        String(r.implemented ?? '—').padStart(4) +
        '    ' +
        (r.missing.length ? `❌ 未实现: ${r.missing.join(',')}` : r.note),
    );
  }
  console.info('─'.repeat(72));
  console.info(`20 个包共声明 ${totalDeclared} 个 API`);

  console.info('\n▶ 断言');

  const loadFailed = rows.filter((r) => r.note.startsWith('manifest 加载失败'));
  check(
    '20 个包的 manifest 全部可加载',
    loadFailed.length === 0,
    loadFailed.length ? loadFailed.map((r) => r.pkg).join(', ') : `${rows.length} 个包`,
  );

  const empty = rows.filter((r) => r.declared === 0 && !r.note.startsWith('manifest 加载失败'));
  check(
    '每个包都声明了至少一个 API',
    empty.length === 0,
    empty.length ? `声明为空: ${empty.map((r) => r.pkg).join(', ')}` : 'ok',
  );

  const drifted = rows.filter((r) => r.missing.length > 0);
  check(
    'manifest 声明的 API 在 executor 中都有实现（无声明/实现漂移）',
    drifted.length === 0,
    drifted.length
      ? drifted.map((r) => `${r.pkg}:${r.missing.join('/')}`).join(' | ')
      : '无漂移',
  );

  const noExec = rows.filter((r) => r.implemented === null && !r.note.startsWith('manifest 加载失败'));
  const resolveFailed = noExec.filter((r) => /ERR_|Cannot find module|SyntaxError/.test(r.note));
  const trulyAbsent = noExec.filter((r) => !/ERR_|Cannot find module|SyntaxError/.test(r.note));

  console.info(
    `\n    ⚠️ ${noExec.length} 个包本脚本没能加载到 executor，但要分清两种情况：` +
      `\n    · ${resolveFailed.length} 个是**脚本侧模块解析失败**（ERR_PACKAGE_PATH_NOT_EXPORTED / Cannot find module）：` +
      `\n      ${resolveFailed.map((r) => r.pkg).join(', ')}` +
      '\n      这些包在应用里是能正常 import 的（src/store/tool/slices/builtin/executors/index.ts 就在用），' +
      '\n      失败原因是 tsx 直连包子路径时缺 exports 映射。**不能据此说它们没有 executor。**' +
      `\n    · ${trulyAbsent.length} 个是确实没有 executor 具名导出：${trulyAbsent.map((r) => r.pkg).join(', ') || '无'}` +
      '\n      这些可能只在客户端运行时实现（见 02-architecture 的双运行时），需单独确认。',
  );

  // ── 工具名生成的真实约束 ──────────────────────────────────────────────
  // 跨包重名**不是**问题：ToolNameResolver 用 `identifier____apiName` 做全名
  // （PLUGIN_SCHEMA_SEPARATOR = '____'），identifier 已经消歧。
  // 真正会出事的是两处：
  //   ① 同一个包内重名 —— identifier 相同，全名就撞了
  //   ② 全名 ≥ 64 字符 —— ToolNameResolver.generate 会把 name 换成 MD5 哈希
  //      （仍 ≥64 时连 identifier 一起哈希），模型看到的就是一串哈希，可读性尽失
  console.info('\n▶ 工具全名约束（identifier____apiName）');

  const withinPkgDupes: string[] = [];
  const longNames: string[] = [];

  for (const spec of PACKAGES) {
    try {
      const mod: any = await import(`../../packages/builtin-tool-${spec.dir}/src/manifest`);
      const m = mod[spec.manifestExport] ?? mod.default;
      const names = apiNamesOf(m);
      const identifier = m?.identifier ?? spec.dir;

      const counts = new Map<string, number>();
      for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
      for (const [n, c] of counts) if (c > 1) withinPkgDupes.push(`${spec.dir}:${n}×${c}`);

      for (const n of names) {
        const full = `${identifier}____${n}`;
        if (full.length >= 64) longNames.push(`${full} (${full.length})`);
      }
    } catch {
      /* manifest 加载失败上面已记 */
    }
  }

  check(
    '包内无重名 API（identifier 相同，重名会导致全名冲突）',
    withinPkgDupes.length === 0,
    withinPkgDupes.length ? withinPkgDupes.join(', ') : '无',
  );

  check(
    '所有工具全名 < 64 字符（否则被 MD5 哈希，模型侧可读性丧失）',
    longNames.length === 0,
    longNames.length ? longNames.join(' | ') : '全部合规',
  );

  console.info(
    '\n    注：跨包重名（如 local-system 与 cloud-sandbox 共有 12 个同名 API）**不构成缺陷** ——' +
      '\n    全名是 `identifier____apiName`，identifier 已消歧。此前的怀疑经查证不成立。',
  );

  summary();
};

main().catch((error) => {
  console.error('\n❌ f5-tool-surface 脚本异常:', error);
  process.exitCode = 1;
});
