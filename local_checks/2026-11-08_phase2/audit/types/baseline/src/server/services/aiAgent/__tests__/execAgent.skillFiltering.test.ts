/**
 * Integration tests for Feishu CLI skill routing via aiAgent/index.ts.
 *
 * Covers the three-part fix for "scheduled task silently fails to expand skill content":
 *   1. Advertise/execute alignment — filterBuiltinSkills({ activeDevice }) gates Feishu CLI
 *   2. deviceStatusNotice injected into systemRole when plan is device-unrouted
 *   3. Desktop-class default — on a gateway-configured server an unset target
 *      resolves to `local` (auto-activates a lone online device, else unrouted)
 */
import type * as ModelBankModule from 'model-bank';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── tests ────────────────────────────────────────────────────────────────────
import { AiAgentService } from '../index';

// ─── hoisted factories ─────────────────────────────────────────────────────────
const {
  mockAgentSkillFindAll,
  mockCreateOperation,
  mockCreateServerAgentToolsEngine,
  mockMessageCreate,
} = vi.hoisted(() => ({
  mockAgentSkillFindAll: vi.fn(),
  mockCreateOperation: vi.fn(),
  mockCreateServerAgentToolsEngine: vi.fn().mockReturnValue({
    generateToolsDetailed: vi.fn().mockReturnValue({ enabledToolIds: [], tools: [] }),
    getEnabledPluginManifests: vi.fn().mockReturnValue(new Map()),
  }),
  mockMessageCreate: vi.fn(),
}));

const { mockDeviceProxy } = vi.hoisted(() => ({
  mockDeviceProxy: {
    isConfigured: false,
    queryDeviceList: vi.fn().mockResolvedValue([]),
  },
}));

// ─── @lobechat/builtin-skills mock ────────────────────────────────────────────
// Provides a controlled, minimal skill list so the test is not coupled to the
// real package contents. Feishu CLI is desktop-only; Regular is always on.
// Literal strings inside the factory because vi.mock is hoisted above const declarations.
vi.mock('@lobechat/builtin-skills', () => ({
  TripYoYoIdentifier: 'TripYoYo',
  OpenCliIdentifier: 'lobe-opencli',
  builtinSkills: [
    {
      content: '',
      description: 'Operate Feishu via lark-cli (desktop only)',
      identifier: 'lobe-feishu-cli',
      name: 'Feishu CLI',
      source: 'builtin',
    },
    {
      content: '',
      description: 'A regular skill always available',
      identifier: 'lobe-regular-skill',
      name: 'Regular',
      source: 'builtin',
    },
  ],
  FeishuCliIdentifier: 'lobe-feishu-cli',
  SANDBOX_BUILTIN_SKILL_IDENTIFIERS: new Set<string>(),
}));

const FEISHU_CLI_ID = 'lobe-feishu-cli';
const REGULAR_SKILL_ID = 'lobe-regular-skill';

// ─── DB / service mocks ───────────────────────────────────────────────────────
vi.mock('@/libs/trusted-client', () => ({
  generateTrustedClientToken: vi.fn().mockReturnValue(undefined),
  getTrustedClientTokenForSession: vi.fn().mockResolvedValue(undefined),
  isTrustedClientEnabled: vi.fn().mockReturnValue(false),
}));

vi.mock('@/database/models/message', () => ({
  MessageModel: vi.fn().mockImplementation(() => ({
    create: mockMessageCreate,
    query: vi.fn().mockResolvedValue([]),
    update: vi.fn().mockResolvedValue({}),
  })),
}));

vi.mock('@/database/models/agent', () => ({
  AgentModel: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue(null),
  })),
}));

vi.mock('@/database/models/agentSkill', () => ({
  AgentSkillModel: vi.fn().mockImplementation(() => ({
    findAll: mockAgentSkillFindAll,
  })),
}));

vi.mock('@/database/models/plugin', () => ({
  PluginModel: vi.fn().mockImplementation(() => ({
    query: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/database/models/topic', () => ({
  TopicModel: vi.fn().mockImplementation(() => ({
    create: vi.fn().mockResolvedValue({ id: 'topic-1' }),
  })),
}));

vi.mock('@/database/models/thread', () => ({
  ThreadModel: vi.fn().mockImplementation(() => ({
    create: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
  })),
}));

vi.mock('@/server/services/agentRuntime', () => ({
  AgentRuntimeService: vi.fn().mockImplementation(() => ({
    createOperation: mockCreateOperation,
  })),
}));

vi.mock('@/server/services/market/openSandbox', () => ({
  collectSandboxFileIdsFromTopic: vi.fn().mockResolvedValue([]),
  renewTopicSandboxSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/market/preInjectSandboxFiles', () => ({
  preInjectSandboxFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/server/services/agent', () => ({
  AgentService: vi.fn().mockImplementation(() => ({
    getAgentConfig: vi.fn().mockResolvedValue({
      chatConfig: {},
      files: [],
      id: 'agent-1',
      knowledgeBases: [],
      model: 'gpt-4',
      plugins: [],
      provider: 'openai',
      systemRole: 'You are a helpful assistant',
    }),
  })),
}));

vi.mock('@/server/services/market', () => ({
  MarketService: vi.fn().mockImplementation(() => ({
    getLobehubSkillManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/klavis', () => ({
  KlavisService: vi.fn().mockImplementation(() => ({
    getKlavisManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock('@/server/services/file', () => ({
  FileService: vi.fn().mockImplementation(() => ({
    uploadFromUrl: vi.fn(),
  })),
}));

vi.mock('@/server/modules/Mecha', () => ({
  createServerAgentToolsEngine: mockCreateServerAgentToolsEngine,
  serverMessagesEngine: vi.fn().mockResolvedValue([{ content: 'test', role: 'user' }]),
}));

vi.mock('@/server/services/toolExecution/deviceProxy', () => ({
  deviceProxy: mockDeviceProxy,
}));

vi.mock('model-bank', async (importOriginal) => {
  const actual = await importOriginal<typeof ModelBankModule>();
  return {
    ...actual,
    LOBE_DEFAULT_MODEL_LIST: [
      {
        abilities: { functionCall: true, video: false, vision: true },
        id: 'gpt-4',
        providerId: 'openai',
      },
    ],
  };
});

// ─── helpers ──────────────────────────────────────────────────────────────────
const BASE_AGENT_CONFIG = {
  chatConfig: {},
  files: [],
  id: 'agent-1',
  knowledgeBases: [],
  model: 'gpt-4',
  plugins: [],
  provider: 'openai',
  systemRole: 'You are a helpful assistant',
};

const ONLINE_DEVICE = {
  deviceId: 'device-001',
  hostname: 'my-laptop',
  lastSeen: '2026-06-01T12:00:00.000Z',
  online: true,
  platform: 'darwin' as const,
};

describe('AiAgentService.execAgent — Feishu CLI skill filtering', () => {
  let service: AiAgentService;
  const mockDb = {} as any;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockMessageCreate.mockResolvedValue({ id: 'msg-1' });
    mockCreateOperation.mockResolvedValue({
      autoStarted: true,
      messageId: 'queue-msg-1',
      operationId: 'op-123',
      success: true,
    });
    mockDeviceProxy.isConfigured = true;
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]);
    mockAgentSkillFindAll.mockResolvedValue({ data: [] });

    // Restore default AgentService (no agencyConfig)
    const { AgentService } = await import('@/server/services/agent');
    vi.mocked(AgentService).mockImplementation(
      () =>
        ({
          getAgentConfig: vi.fn().mockResolvedValue(BASE_AGENT_CONFIG),
        }) as any,
    );

    service = new AiAgentService(mockDb, 'user-1');
  });

  it('includes Feishu CLI in skillMetas when boundDeviceId is online', async () => {
    // Agent has a bound device and that device is currently online
    const { AgentService } = await import('@/server/services/agent');
    vi.mocked(AgentService).mockImplementation(
      () =>
        ({
          getAgentConfig: vi.fn().mockResolvedValue({
            ...BASE_AGENT_CONFIG,
            agencyConfig: { boundDeviceId: 'device-001' },
          }),
        }) as any,
    );
    mockDeviceProxy.queryDeviceList.mockResolvedValue([ONLINE_DEVICE]);

    service = new AiAgentService(mockDb, 'user-1');
    await service.execAgent({ agentId: 'agent-1', prompt: 'send a Feishu message' });

    const { skillMetas, activeDeviceId } = mockCreateOperation.mock.calls[0][0];
    expect(activeDeviceId).toBe('device-001');
    expect(skillMetas.map((s: { identifier: string }) => s.identifier)).toContain(FEISHU_CLI_ID);
    expect(skillMetas.map((s: { identifier: string }) => s.identifier)).toContain(REGULAR_SKILL_ID);
  });

  it('excludes Feishu CLI and injects <device_status> notice when bound device is offline', async () => {
    // Agent is bound but the device is not in the online list → device-unrouted
    const { AgentService } = await import('@/server/services/agent');
    vi.mocked(AgentService).mockImplementation(
      () =>
        ({
          getAgentConfig: vi.fn().mockResolvedValue({
            ...BASE_AGENT_CONFIG,
            agencyConfig: { boundDeviceId: 'device-001' },
          }),
        }) as any,
    );
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]); // device offline

    service = new AiAgentService(mockDb, 'user-1');
    await service.execAgent({ agentId: 'agent-1', prompt: 'send a Feishu message' });

    const { skillMetas, activeDeviceId, agentConfig } = mockCreateOperation.mock.calls[0][0];

    // Device unrouted → no activeDeviceId
    expect(activeDeviceId).toBeUndefined();

    // Feishu CLI must NOT be in the advertised skill list
    expect(skillMetas.map((s: { identifier: string }) => s.identifier)).not.toContain(
      FEISHU_CLI_ID,
    );

    // Regular skills are still available
    expect(skillMetas.map((s: { identifier: string }) => s.identifier)).toContain(REGULAR_SKILL_ID);

    // systemRole must contain the device-status degradation notice
    expect(agentConfig.systemRole).toContain('<device_status>');
    expect(agentConfig.systemRole).toContain('do NOT claim the action succeeded');
  });

  it('auto-activates a single online device for an unset target on a gateway server (desktop-class default)', async () => {
    // No agencyConfig at all. A server wired to a device-gateway is serving
    // desktop-class users, so an UNSET target defaults to `local`
    // (clientExecutionAvailable) and a single online device is auto-activated —
    // matching lobehub. (`execAgent` passes `gatewayConfigured` as `isDesktop`.)
    mockDeviceProxy.queryDeviceList.mockResolvedValue([ONLINE_DEVICE]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const { skillMetas, activeDeviceId, agentConfig } = mockCreateOperation.mock.calls[0][0];

    // The single online device is auto-activated → routed.
    expect(activeDeviceId).toBe(ONLINE_DEVICE.deviceId);

    // Feishu CLI is advertised (there is a device to run it on).
    expect(skillMetas.map((s: { identifier: string }) => s.identifier)).toContain(FEISHU_CLI_ID);

    // Routed successfully → no degradation notice.
    expect(agentConfig.systemRole ?? '').not.toContain('<device_status>');
  });

  it('excludes Feishu CLI and injects the notice for an unset target when NO device is online', async () => {
    // Same desktop-class default (`local`), but with nothing online the run is
    // device-unrouted: device-only skills are dropped and the agent is told.
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]);

    await service.execAgent({ agentId: 'agent-1', prompt: 'Hello' });

    const { skillMetas, activeDeviceId, agentConfig } = mockCreateOperation.mock.calls[0][0];

    expect(activeDeviceId).toBeUndefined();
    expect(skillMetas.map((s: { identifier: string }) => s.identifier)).not.toContain(
      FEISHU_CLI_ID,
    );
    expect(agentConfig.systemRole).toContain('<device_status>');
  });

  it('excludes DB skills that have not passed the web safety scan from skillMetas without an active device', async () => {
    mockDeviceProxy.queryDeviceList.mockResolvedValue([]);
    mockAgentSkillFindAll.mockResolvedValue({
      data: [
        {
          description: 'Only uploaded through desktop',
          identifier: 'frontend-design',
          name: 'frontend-design',
          webSafeScanPassed: false,
        },
        {
          description: 'Safe web skill',
          identifier: 'playwright-cli-2',
          name: 'playwright-cli-2',
          webSafeScanPassed: true,
        },
      ],
    });

    await service.execAgent({ agentId: 'agent-1', prompt: 'what skills are available?' });

    const { agentConfig, skillMetas } = mockCreateOperation.mock.calls[0][0];
    const skillIdentifiers = skillMetas.map((s: { identifier: string }) => s.identifier);

    expect(skillIdentifiers).not.toContain('frontend-design');
    expect(skillIdentifiers).toContain('playwright-cli-2');
    expect(agentConfig.systemRole).toContain('<unavailable_skills>');
    expect(agentConfig.systemRole).toContain('frontend-design');
    expect(agentConfig.systemRole).toContain('sync it to web first');
  });
});
