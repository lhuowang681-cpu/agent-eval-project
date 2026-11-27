import type { SkillResourceMeta } from '@lobechat/types';

const stripLeadingDotSlash = (path: string): string => path.replace(/^\.\//, '');

const basenameWithoutExtension = (path: string): string => path.replace(/\.[^./]+$/, '');

/**
 * Resolve a readReference path against builtin skill resources.
 * Tries exact match first, then common variants (case, with/without .md).
 */
export const resolveBuiltinSkillResource = (
  resources: Record<string, SkillResourceMeta>,
  rawPath: string,
): { meta: SkillResourceMeta; resolvedPath: string } | undefined => {
  const path = stripLeadingDotSlash(rawPath);
  const candidates = new Set<string>([
    path,
    path.toLowerCase(),
    basenameWithoutExtension(path),
    basenameWithoutExtension(path).toLowerCase(),
    path.endsWith('.md') ? path : `${path}.md`,
    path.endsWith('.md') ? path.toLowerCase() : `${path}.md`.toLowerCase(),
  ]);

  for (const candidate of candidates) {
    const meta = resources[candidate];
    if (meta?.content !== undefined) {
      return { meta, resolvedPath: candidate };
    }
  }

  for (const [key, meta] of Object.entries(resources)) {
    if (meta.content === undefined) continue;

    const keyLower = key.toLowerCase();
    const pathLower = path.toLowerCase();
    const pathStemLower = basenameWithoutExtension(path).toLowerCase();
    const keyStemLower = basenameWithoutExtension(key).toLowerCase();

    if (
      keyLower === pathLower ||
      keyLower === pathStemLower ||
      keyStemLower === pathLower ||
      keyStemLower === pathStemLower
    ) {
      return { meta, resolvedPath: key };
    }
  }

  return undefined;
};
