import { FEISHU_MCP_IDENTIFIER } from '@lobechat/builtin-mcp-feishu';
import { CloudSandboxManifest } from '@lobechat/builtin-tool-cloud-sandbox';
import { beforeEach, describe, expect, it } from 'vitest';

import { createServerConfigStore } from '@/store/serverConfig/store';

import { type ToolStoreState } from '../../initialState';
import { initialState } from '../../initialState';
import { builtinToolSelectors } from './selectors';

// Mock builtin skill for testing
const mockBuiltinSkill = {
  avatar: '🧪',
  content: '# Test Skill',
  description: 'A test skill',
  identifier: 'test-skill',
  name: 'Test Skill',
  source: 'builtin' as const,
};

describe('builtinToolSelectors', () => {
  beforeEach(() => {
    const store = createServerConfigStore();
    store.setState({
      featureFlags: {
        ...store.getState().featureFlags,
        enableCloudSandbox: true,
      },
    });
  });

  describe('metaList', () => {
    it('should return meta list with builtin tools and skills', () => {
      const state = {
        ...initialState,
        builtinSkills: [mockBuiltinSkill],
        builtinTools: [
          {
            identifier: 'tool-1',
            type: 'builtin',
            manifest: { api: [], identifier: 'tool-1', meta: { title: 'Tool 1' }, systemRole: '' },
          },
        ],
        uninstalledBuiltinTools: [FEISHU_MCP_IDENTIFIER],
      } as ToolStoreState;
      const result = builtinToolSelectors.metaList(state);
      expect(result).toEqual([
        {
          author: 'TripYoYo',
          identifier: 'test-skill',
          meta: { avatar: '🧪', description: 'A test skill', title: 'Test Skill' },
          type: 'builtin',
        },
        { author: 'TripYoYo', identifier: 'tool-1', meta: { title: 'Tool 1' }, type: 'builtin' },
      ]);
    });

    it('should hide tool when not need visible with hidden', () => {
      const state = {
        ...initialState,
        builtinSkills: [mockBuiltinSkill],
        builtinTools: [
          {
            identifier: 'tool-1',
            type: 'builtin',
            hidden: true,
            manifest: { api: [], identifier: 'tool-1', meta: { title: 'Tool 1' }, systemRole: '' },
          },
        ],
        uninstalledBuiltinTools: [FEISHU_MCP_IDENTIFIER],
      } as ToolStoreState;
      const result = builtinToolSelectors.metaList(state);
      // Should only contain skill, hidden tool is filtered out
      expect(result).toEqual([
        {
          author: 'TripYoYo',
          identifier: 'test-skill',
          meta: { avatar: '🧪', description: 'A test skill', title: 'Test Skill' },
          type: 'builtin',
        },
      ]);
    });

    it('should return an empty list if no builtin tools or skills are available', () => {
      const state: ToolStoreState = {
        ...initialState,
        builtinSkills: [],
        builtinTools: [],
        uninstalledBuiltinTools: [FEISHU_MCP_IDENTIFIER],
      };
      const result = builtinToolSelectors.metaList(state);
      expect(result).toEqual([]);
    });
  });

  describe('profile config lists', () => {
    it('should hide Cloud Sandbox when feature flag is disabled', () => {
      const store = createServerConfigStore();
      store.setState({
        featureFlags: {
          ...store.getState().featureFlags,
          enableCloudSandbox: false,
        },
      });

      const state = {
        ...initialState,
        builtinTools: [
          {
            identifier: CloudSandboxManifest.identifier,
            manifest: CloudSandboxManifest,
            type: 'builtin',
          },
          {
            identifier: 'tool-1',
            manifest: { api: [], identifier: 'tool-1', meta: { title: 'Tool 1' }, systemRole: '' },
            type: 'builtin',
          },
        ],
        uninstalledBuiltinTools: [],
      } as ToolStoreState;

      const allConfigurableIds = builtinToolSelectors
        .allMetaList(state)
        .map((item) => item.identifier);
      const installedConfigurableIds = builtinToolSelectors
        .installedAllMetaList(state)
        .map((item) => item.identifier);

      expect(allConfigurableIds).toContain('tool-1');
      expect(allConfigurableIds).not.toContain(CloudSandboxManifest.identifier);
      expect(installedConfigurableIds).toContain('tool-1');
      expect(installedConfigurableIds).not.toContain(CloudSandboxManifest.identifier);
    });
  });
});
