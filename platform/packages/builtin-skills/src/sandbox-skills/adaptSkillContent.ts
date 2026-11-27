import { type SandboxOfficeSkillId, sandboxSkillPublicPath } from './constants';

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

const SANDBOX_EXECUTION_PREAMBLE = `## Sandbox execution

The cloud sandbox working directory is \`/\`. **Never** \`cd\` into the skill directory.

- Skill scripts live under \`/mnt/skills/public/<skill>/scripts/\`.
- Invoke scripts with **absolute paths**, e.g. \`python /mnt/skills/public/docx/scripts/office/unpack.py ...\`.
- User uploads: \`/mnt/user-data/uploads/<filename>\`.
- Agent-generated outputs: write under \`/mnt/user-data/outputs/<english_filename>\`, then \`exportFile\`.
- Dependencies are **pre-installed** — do not run \`pip install\`, \`npm install\`, or package managers.

`;

export const stripYamlFrontmatter = (markdown: string): string =>
  markdown.replace(FRONTMATTER_RE, '');

export const parseFrontmatterDescription = (markdown: string): string | undefined => {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return undefined;

  const descLine = match[1].split('\n').find((line) => line.startsWith('description:'));
  if (!descLine) return undefined;

  const raw = descLine.slice('description:'.length).trim();
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replaceAll('\\"', '"');
  }

  return raw;
};

/** Rewrite upstream Anthropic skill markdown for the TripYoYo sandbox layout. */
export const adaptSandboxOfficeSkillContent = (
  skillId: SandboxOfficeSkillId,
  markdown: string,
): string => {
  const skillRoot = sandboxSkillPublicPath(skillId);
  const scriptsRoot = `${skillRoot}/scripts`;

  let content = stripYamlFrontmatter(markdown);

  content = content.replaceAll('python scripts/', `python ${scriptsRoot}/`);
  content = content.replaceAll('`scripts/', `\`${scriptsRoot}/`);

  // forms.md: "Run this script from this file's directory"
  content = content.replaceAll(
    /from this file's directory:?\s*`/g,
    'using absolute script paths: `',
  );

  // Remove install instructions (deps are baked into the image)
  content = content.replaceAll(/^.*`npm install.*$\n?/gm, '');
  content = content.replaceAll(/^.*`pip install.*$\n?/gm, '');
  content = content.replaceAll(/^Install: `npm install.*$\n?/gm, '');
  content = content.replaceAll(
    /^- `pip install "markitdown\[pptx\]"`.*$\n?/gm,
    '- `python -m markitdown` (pre-installed)\n',
  );
  content = content.replaceAll(/^- `pip install Pillow`.*$\n?/gm, '- Pillow (pre-installed)\n');
  content = content.replaceAll(
    /^- `npm install -g pptxgenjs`.*$\n?/gm,
    '- pptxgenjs (pre-installed globally)\n',
  );

  return `${SANDBOX_EXECUTION_PREAMBLE}${content}`;
};
