import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerInstallCommand, resolveClaudeSkillDir, writeClaudeSkill } from './install';

describe('install command', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let tmpDir: string;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    tmpDir = mkdtempSync(join(tmpdir(), 'tripyoyo-skill-test-'));
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    rmSync(tmpDir, { force: true, recursive: true });
  });

  function createProgram() {
    const program = new Command();
    program.exitOverride();
    registerInstallCommand(program);
    return program;
  }

  it('resolves the default skill directory under ~/.claude/skills/tripyoyo', () => {
    expect(resolveClaudeSkillDir()).toMatch(/[/\\]\.claude[/\\]skills[/\\]tripyoyo$/);
  });

  it('writes SKILL.md and reference files to the target directory', () => {
    const { referenceCount, targetDir } = writeClaudeSkill(tmpDir);

    const skillMd = readFileSync(join(tmpDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: tripyoyo');
    expect(skillMd).toContain('lh plugin');

    const referenceNames = readdirSync(join(tmpDir, 'references'));
    expect(referenceNames.length).toBe(referenceCount);
    expect(referenceNames).toContain('plugin.md');
    expect(referenceNames).toContain('market.md');
    expect(targetDir).toBe(tmpDir);

    const pluginMd = readFileSync(join(tmpDir, 'references', 'plugin.md'), 'utf8');
    expect(pluginMd).toContain('--custom-params');
    expect(pluginMd).toContain('plugin sync');
  });

  it('supports --dir to override the target directory', async () => {
    const program = createProgram();
    await program.parseAsync(['node', 'test', 'install', '--dir', tmpDir]);

    const skillMd = readFileSync(join(tmpDir, 'SKILL.md'), 'utf8');
    expect(skillMd).toContain('name: tripyoyo');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Installed Claude Code skill'));
  });
});
