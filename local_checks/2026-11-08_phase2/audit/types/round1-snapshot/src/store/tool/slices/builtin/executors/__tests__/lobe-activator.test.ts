import { SkillStoreManifest } from '@lobechat/builtin-tool-skill-store';
import { type BuiltinToolContext } from '@lobechat/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getToolStoreState = vi.fn();

vi.mock('@/store/tool', () => ({
  getToolStoreState,
}));

const createContext = (): BuiltinToolContext => ({
  messageId: 'message-id',
});

describe('lobeActivatorExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getToolStoreState.mockReturnValue({
      agentSkills: [],
      builtinSkills: [],
      builtinTools: [
        {
          discoverable: false,
          hidden: true,
          identifier: SkillStoreManifest.identifier,
          manifest: SkillStoreManifest,
          type: 'builtin',
        },
      ],
      installedPlugins: [],
      lobehubSkillServers: [],
      servers: [],
      uninstalledBuiltinTools: [],
    });
  });

  it('treats hidden always-on tools as already active instead of not found', async () => {
    const { lobeActivatorExecutor } = await import('../lobe-activator');

    const result = await lobeActivatorExecutor.invoke(
      'activateTools',
      {
        identifiers: [SkillStoreManifest.identifier],
        reason: 'search skills',
      },
      createContext(),
    );

    expect(result.success).toBe(true);
    expect(result.state).toMatchObject({
      alreadyActive: [SkillStoreManifest.identifier],
      notFound: [],
    });
    expect(result.content).not.toContain(`Not found: ${SkillStoreManifest.identifier}`);
  }, 15_000);
});
