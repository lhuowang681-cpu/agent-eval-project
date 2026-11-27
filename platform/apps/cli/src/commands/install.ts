import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { Command } from 'commander';
import pc from 'picocolors';

import { referenceFiles, skillMd } from '../generated/skillContent';

export const resolveClaudeSkillDir = () => join(homedir(), '.claude', 'skills', 'tripyoyo');

/**
 * Writes the bundled Claude Code skill (SKILL.md + references/*.md) to `targetDir`.
 * Content is generated from packages/builtin-skills/src/tripyoyo — see
 * scripts/generate-cli-skill-content.ts for the single source of truth. The
 * references directory is reset first so reference files removed/renamed
 * upstream since the last install don't linger as stale orphans.
 */
export const writeClaudeSkill = (targetDir: string) => {
  const referencesDir = join(targetDir, 'references');
  rmSync(referencesDir, { force: true, recursive: true });
  mkdirSync(referencesDir, { recursive: true });
  writeFileSync(join(targetDir, 'SKILL.md'), skillMd);

  for (const [name, content] of Object.entries(referenceFiles)) {
    writeFileSync(join(referencesDir, name), content);
  }

  return { referenceCount: Object.keys(referenceFiles).length, targetDir };
};

export function registerInstallCommand(program: Command) {
  program
    .command('install')
    .description(
      'Install the Claude Code skill for driving this CLI (writes to ~/.claude/skills/tripyoyo)',
    )
    .option('--dir <path>', 'Target skill directory (defaults to ~/.claude/skills/tripyoyo)')
    .action((options: { dir?: string }) => {
      const targetDir = options.dir ?? resolveClaudeSkillDir();
      const { referenceCount } = writeClaudeSkill(targetDir);

      console.log(`${pc.green('✓')} Installed Claude Code skill to ${pc.bold(targetDir)}`);
      console.log(`  SKILL.md + ${referenceCount} reference file(s)`);
      console.log(`\nRestart Claude Code to load the skill.`);
    });
}
