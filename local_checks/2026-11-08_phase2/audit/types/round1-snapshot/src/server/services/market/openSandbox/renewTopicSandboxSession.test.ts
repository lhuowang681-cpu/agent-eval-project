import { afterEach, describe, expect, it, vi } from 'vitest';

import { SandboxToolClient } from '../sandboxToolClient';
import { renewTopicSandboxSession } from './renewTopicSandboxSession';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SandboxToolClient.renewSessionIfActive', () => {
  it('returns false when client cache is idle-expired', async () => {
    const renew = vi.fn();
    const getInfo = vi.fn();
    const client = Object.create(SandboxToolClient.prototype) as SandboxToolClient;

    vi.spyOn(client as any, 'getSessionTtlMs').mockReturnValue(60_000);
    vi.spyOn(client as any, 'getTimeoutSeconds').mockReturnValue(60);

    const sessions = (SandboxToolClient as any).sessions as Map<string, unknown>;
    sessions.set('topic-1', {
      sandbox: { renew, getInfo },
      createdAt: Date.now() - 120_000,
      lastAccessAt: Date.now() - 120_000,
      injectedFiles: [],
    });

    const renewed = await client.renewSessionIfActive('topic-1');

    expect(renewed).toBe(false);
    expect(renew).not.toHaveBeenCalled();
    expect(getInfo).not.toHaveBeenCalled();

    sessions.delete('topic-1');
  });

  it('renews cached sandbox when still active', async () => {
    const renew = vi
      .fn()
      .mockResolvedValue({ expiresAt: new Date(Date.now() + 1_800_000).toISOString() });
    const getInfo = vi.fn().mockResolvedValue({ expiresAt: new Date(Date.now() + 600_000) });
    const client = Object.create(SandboxToolClient.prototype) as SandboxToolClient;

    vi.spyOn(client as any, 'getSessionTtlMs').mockReturnValue(1_800_000);
    vi.spyOn(client as any, 'getTimeoutSeconds').mockReturnValue(1_800);

    const sessions = (SandboxToolClient as any).sessions as Map<string, any>;
    const entry = {
      sandbox: { renew, getInfo },
      createdAt: Date.now(),
      lastAccessAt: Date.now() - 1_000,
      injectedFiles: [],
    };
    sessions.set('topic-2', entry);

    const renewed = await client.renewSessionIfActive('topic-2');

    expect(renewed).toBe(true);
    expect(getInfo).toHaveBeenCalled();
    expect(renew).toHaveBeenCalledWith(1_800);

    sessions.delete('topic-2');
  });
});

describe('renewTopicSandboxSession', () => {
  it('delegates to sandbox client and returns renewal result', async () => {
    const renewSessionIfActive = vi.fn().mockResolvedValue(true);
    const sandboxClient = { renewSessionIfActive } as unknown as SandboxToolClient;

    const renewed = await renewTopicSandboxSession({
      sandboxClient,
      topicId: 'topic-3',
    });

    expect(renewed).toBe(true);
    expect(renewSessionIfActive).toHaveBeenCalledWith('topic-3');
  });

  it('returns false when renewal throws', async () => {
    const sandboxClient = {
      renewSessionIfActive: vi.fn().mockRejectedValue(new Error('network error')),
    } as unknown as SandboxToolClient;

    const renewed = await renewTopicSandboxSession({
      sandboxClient,
      topicId: 'topic-4',
    });

    expect(renewed).toBe(false);
  });
});
