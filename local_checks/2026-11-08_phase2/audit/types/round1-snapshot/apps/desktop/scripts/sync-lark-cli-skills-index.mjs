import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Regenerates the "domain routing table" baked into the Feishu CLI builtin
// skill's prompt (packages/builtin-skills/src/feishu-cli/skillsIndex.generated.ts).
//
// lark-cli bundles its own AI-agent skill set (lark-doc, lark-base, lark-vc, ...)
// as reference docs inside the binary — `lark-cli skills list` dumps their
// name + description (this is the same set installable via
// `npx skills add larksuite/cli`). Those descriptions carry routing/boundary
// knowledge ("不负责 X，走 Y") that `--help` can't express, so we embed a
// compact copy directly in the Feishu CLI skill prompt.
//
// This must be re-run (and the output re-committed) every time VERSION in
// download-lark-cli.mjs is bumped — otherwise the table silently drifts from
// the bundled binary, the same class of staleness called out for hand-written
// flag docs in that script's comments.
//
// Usage: node scripts/sync-lark-cli-skills-index.mjs
// (run `npm run download:lark-cli` first so resources/bin/lark-cli exists and
// matches the target VERSION)

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isWindows = process.platform === 'win32';
const binPath = path.join(
  __dirname,
  '..',
  'resources',
  'bin',
  `lark-cli${isWindows ? '.exe' : ''}`,
);
const versionFile = path.join(__dirname, '..', 'resources', 'bin', '.lark-cli-version');
const outFile = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'builtin-skills',
  'src',
  'feishu-cli',
  'skillsIndex.generated.ts',
);

if (!fs.existsSync(binPath)) {
  console.error(
    `[lark-cli-skills] ❌ binary not found at ${binPath}. Run "npm run download:lark-cli" first.`,
  );
  process.exit(1);
}

const version = fs.existsSync(versionFile)
  ? fs.readFileSync(versionFile, 'utf8').trim()
  : 'unknown';

const raw = execFileSync(binPath, ['skills', 'list'], { encoding: 'utf8' });
const { ok, skills } = JSON.parse(raw);

if (!ok || !Array.isArray(skills) || skills.length === 0) {
  console.error('[lark-cli-skills] ❌ unexpected `lark-cli skills list` output:', raw);
  process.exit(1);
}

// Names/descriptions can themselves contain backticks or `${...}`-like text
// (e.g. lark-event's description quotes `--max-events`), so this must be
// JSON-escaped into a plain string literal rather than interpolated into a
// template literal.
const table = skills
  .slice()
  .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''))
  .map((s) => `- ${s.name ?? '(unnamed)'}: ${(s.description ?? '').trim()}`)
  .join('\n');

const fileContent = `// AUTO-GENERATED — do not hand-edit.
// Source: \`lark-cli skills list\` run against resources/bin/lark-cli v${version}.
// Regenerate with: node apps/desktop/scripts/sync-lark-cli-skills-index.mjs
// (after \`npm run download:lark-cli\` to fetch the target VERSION's binary)
// whenever VERSION in apps/desktop/scripts/download-lark-cli.mjs is bumped.

export const larkCliSkillsIndexVersion = ${JSON.stringify(version)};

export const larkCliSkillsIndex = ${JSON.stringify(table)};
`;

fs.writeFileSync(outFile, fileContent, 'utf8');
console.info(
  `[lark-cli-skills] ✅ wrote ${skills.length} skill descriptions (v${version}) → ${outFile}`,
);
