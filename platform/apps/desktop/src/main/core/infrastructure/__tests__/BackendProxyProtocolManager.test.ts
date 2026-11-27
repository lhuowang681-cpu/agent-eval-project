import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendProxyProtocolManager } from '../BackendProxyProtocolManager';

const { mockProtocol, protocolHandlerRef, netFetchMock } = vi.hoisted(() => {
  const protocolHandlerRef = { current: null as any };

  return {
    mockProtocol: {
      handle: vi.fn((_scheme: string, handler: any) => {
        protocolHandlerRef.current = handler;
      }),
    },
    netFetchMock: vi.fn(),
    protocolHandlerRef,
  };
});

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  net: { fetch: netFetchMock },
}));

vi.mock('electron-is', () => ({
  dev: vi.fn(() => false),
  macOS: vi.fn(() => false),
  windows: vi.fn(() => false),
  linux: vi.fn(() => true),
}));

vi.mock('@/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('BackendProxyProtocolManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    protocolHandlerRef.current = null;
  });

  it('should rewrite url to remote base and inject Oidc-Auth token', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = { protocol: mockProtocol } as any;

    netFetchMock.mockImplementation(async () => {
      return new Response('ok', {
        headers: { 'Content-Type': 'text/plain' },
        status: 200,
        statusText: 'OK',
      });
    });

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => 'token-123',
      getRemoteBaseUrl: async () => 'https://remote.example.com',
      scheme: 'lobe-backend',
      source: 'main',
    });

    const handler = protocolHandlerRef.current;
    expect(mockProtocol.handle).toHaveBeenCalledWith('lobe-backend', expect.any(Function));

    const response = await handler({
      headers: new Headers({ 'Origin': 'app://desktop', 'X-Test': '1' }),
      method: 'GET',
      url: 'lobe-backend://app/trpc/hello?batch=1',
    } as any);

    expect(netFetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, init] = netFetchMock.mock.calls[0]!;
    expect(calledUrl).toBe('https://remote.example.com/trpc/hello?batch=1');
    expect(init).toBeDefined();
    if (!init) throw new Error('Expected fetch init to be defined');

    expect(init.method).toBe('GET');
    const headers = init.headers as Headers;
    expect(headers.get('Oidc-Auth')).toBe('token-123');
    expect(headers.get('X-Test')).toBe('1');

    expect(response.status).toBe(200);
    expect(response.headers.get('X-Src-Url')).toBe('https://remote.example.com/trpc/hello?batch=1');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('app://desktop');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(await response.text()).toBe('ok');
  });

  it('should forward body and set duplex for non-GET requests', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = { protocol: mockProtocol } as any;

    netFetchMock.mockImplementation(async () => new Response('ok', { status: 200 }));

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'https://remote.example.com',
      scheme: 'lobe-backend',
    });

    const handler = protocolHandlerRef.current;

    await handler({
      headers: new Headers(),
      method: 'POST',
      // body doesn't have to be a real stream for this unit test; manager only checks truthiness
      body: 'payload' as any,
      url: 'lobe-backend://app/api/upload',
    } as any);

    const [, init] = netFetchMock.mock.calls[0]!;
    expect(init).toBeDefined();
    if (!init) throw new Error('Expected fetch init to be defined');

    expect(init.method).toBe('POST');
    expect(init.body).toBe('payload');
    expect(init.duplex).toBe('half');
  });

  it('should return null when remote base url is missing', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = { protocol: mockProtocol } as any;

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => 'token',
      getRemoteBaseUrl: async () => null,
      scheme: 'lobe-backend',
    });

    const handler = protocolHandlerRef.current;
    const res = await handler({ method: 'GET', url: 'lobe-backend://app/trpc' } as any);

    expect(res).toBeNull();
    expect(netFetchMock).not.toHaveBeenCalled();
  });

  it('should return null when request url is already the remote origin', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = { protocol: mockProtocol } as any;

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'https://remote.example.com',
      scheme: 'lobe-backend',
    });

    const handler = protocolHandlerRef.current;
    const res = await handler({
      method: 'GET',
      url: 'https://remote.example.com/trpc/hello?x=1',
    } as any);

    expect(res).toBeNull();
    expect(netFetchMock).not.toHaveBeenCalled();
  });

  it('should return null when rewrite fails (invalid remote base url)', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = { protocol: mockProtocol } as any;

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'not-a-url',
      scheme: 'lobe-backend',
    });

    const handler = protocolHandlerRef.current;
    const res = await handler({ method: 'GET', url: 'lobe-backend://app/trpc' } as any);

    expect(res).toBeNull();
    expect(netFetchMock).not.toHaveBeenCalled();
  });

  it('should throw when upstream fetch throws', async () => {
    const manager = new BackendProxyProtocolManager();
    const session = { protocol: mockProtocol } as any;

    netFetchMock.mockImplementation(async () => {
      throw new Error('network down');
    });

    manager.registerWithRemoteBaseUrl(session, {
      getAccessToken: async () => null,
      getRemoteBaseUrl: async () => 'https://remote.example.com',
      scheme: 'lobe-backend',
    });

    const handler = protocolHandlerRef.current;
    await expect(
      handler({
        headers: new Headers(),
        method: 'GET',
        url: 'lobe-backend://app/trpc/hello',
      } as any),
    ).rejects.toThrow('network down');
  });
});
