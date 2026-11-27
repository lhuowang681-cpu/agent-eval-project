import { beforeEach, describe, expect, it, vi } from 'vitest';

import { desktopSkillRuntimeService } from '@/services/electron/desktopSkillRuntime';

const {
  getByIdMock,
  getByNameMock,
  getZipUrlMock,
  prepareSkillDirectoryMock,
  resolveSkillResourcePathMock,
} = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  getByNameMock: vi.fn(),
  getZipUrlMock: vi.fn(),
  prepareSkillDirectoryMock: vi.fn(),
  resolveSkillResourcePathMock: vi.fn(),
}));

vi.mock('@/services/skill', () => ({
  agentSkillService: {
    getById: getByIdMock,
    getByName: getByNameMock,
    getZipUrl: getZipUrlMock,
  },
}));

vi.mock('@/services/electron/localFileService', () => ({
  localFileService: {
    prepareSkillDirectory: prepareSkillDirectoryMock,
    resolveSkillResourcePath: resolveSkillResourcePathMock,
  },
}));

describe('desktopSkillRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resolves local execution directory for zipped market skill', async () => {
    getByIdMock.mockResolvedValue({
      id: 'skill-1',
      name: 'Playwright Skill',
      zipFileHash: 'hash-1',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'Playwright Skill',
      url: 'https://files.example/skills/hash-1.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/lobeyoyo/skills/hash-1',
      success: true,
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { id: 'skill-1', name: 'Playwright Skill' },
    ]);

    expect(getByIdMock).toHaveBeenCalledWith('skill-1');
    expect(getZipUrlMock).toHaveBeenCalledWith('skill-1');
    expect(prepareSkillDirectoryMock).toHaveBeenCalledWith({
      url: 'https://files.example/skills/hash-1.zip',
      zipHash: 'hash-1',
    });
    expect(result).toBe('/tmp/lobeyoyo/skills/hash-1');
  });

  it('should fall back to skill name when config id is not a persisted skill id', async () => {
    getByIdMock.mockResolvedValue(undefined);
    getByNameMock.mockResolvedValue({
      id: 'skill-1',
      name: 'demo-skill',
      zipFileHash: 'zip-hash-1',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'demo-skill',
      url: 'https://example.com/demo-skill.zip',
    });
    prepareSkillDirectoryMock.mockResolvedValue({
      extractedDir: '/tmp/demo-skill',
      success: true,
      zipPath: '/tmp/demo-skill.zip',
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { id: 'lobe-skills-run-0', name: 'demo-skill' },
    ]);

    expect(getByIdMock).toHaveBeenCalledWith('lobe-skills-run-0');
    expect(getByNameMock).toHaveBeenCalledWith('demo-skill');
    expect(getZipUrlMock).toHaveBeenCalledWith('skill-1');
    expect(result).toBe('/tmp/demo-skill');
  });

  it('returns undefined when installed skill has no zipFileHash', async () => {
    getByIdMock.mockResolvedValue({
      id: 'legacy-skill',
      name: 'Legacy Skill',
      zipFileHash: null,
    });

    const result = await desktopSkillRuntimeService.resolveExecutionDirectory([
      { id: 'legacy-skill', name: 'Legacy Skill' },
    ]);

    expect(getZipUrlMock).not.toHaveBeenCalled();
    expect(prepareSkillDirectoryMock).not.toHaveBeenCalled();
    expect(result).toBeUndefined();
  });

  it('should resolve the full local path for a referenced skill resource', async () => {
    getByNameMock.mockResolvedValue({
      id: 'skill-1',
      name: 'demo-skill',
      zipFileHash: 'zip-hash-1',
    });
    getZipUrlMock.mockResolvedValue({
      name: 'demo-skill',
      url: 'https://example.com/demo-skill.zip',
    });
    resolveSkillResourcePathMock.mockResolvedValue({
      fullPath: '/tmp/demo-skill/docs/bazi.py',
      success: true,
      zipPath: '/tmp/demo-skill.zip',
    });

    const result = await desktopSkillRuntimeService.resolveReferenceFullPath({
      path: 'docs/bazi.py',
      skillName: 'demo-skill',
    });

    expect(resolveSkillResourcePathMock).toHaveBeenCalledWith({
      path: 'docs/bazi.py',
      url: 'https://example.com/demo-skill.zip',
      zipHash: 'zip-hash-1',
    });
    expect(result).toBe('/tmp/demo-skill/docs/bazi.py');
  });
});
