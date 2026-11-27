/**
 * @vitest-environment node
 */
import { type NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('debug', () => ({
  default: () => vi.fn(),
}));

// APP_URL is read at module load time inside the adapter; default to https so
// the scheme-forcing logic resolves to https in tests.
vi.mock('@/envs/app', () => ({
  appEnv: {
    APP_URL: 'https://example.com',
  },
}));

/**
 * Build a minimal NextRequest stand-in sufficient for createNodeRequest's GET
 * path (no body parsing is triggered for GET).
 */
const buildRequest = (headers: Record<string, string> = {}): NextRequest =>
  ({
    headers: new Headers(headers),
    method: 'GET',
    url: 'https://example.com/oidc/session/end',
  }) as unknown as NextRequest;

describe('createNodeRequest - scheme forcing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('sets socket.encrypted to true when APP_URL is https', async () => {
    const { createNodeRequest } = await import('./http-adapter');

    const nodeReq = (await createNodeRequest(buildRequest())) as any;

    expect(nodeReq.socket.encrypted).toBe(true);
  });

  it('forces x-forwarded-proto to https when APP_URL is https', async () => {
    const { createNodeRequest } = await import('./http-adapter');

    const nodeReq = (await createNodeRequest(buildRequest())) as any;

    expect(nodeReq.headers['x-forwarded-proto']).toBe('https');
  });

  it('overrides an upstream x-forwarded-proto: http with the APP_URL scheme', async () => {
    // Reproduces the fat0 SLB case: TLS terminated upstream, plain http to the
    // container, SLB truthfully forwards `X-Forwarded-Proto: http`. The adapter
    // must override it so oidc-provider keeps generating https URLs.
    const { createNodeRequest } = await import('./http-adapter');

    const nodeReq = (await createNodeRequest(buildRequest({ 'x-forwarded-proto': 'http' }))) as any;

    expect(nodeReq.headers['x-forwarded-proto']).toBe('https');
    expect(nodeReq.socket.encrypted).toBe(true);
  });

  it('backfills x-forwarded-host from APP_URL when absent', async () => {
    const { createNodeRequest } = await import('./http-adapter');

    const nodeReq = (await createNodeRequest(buildRequest())) as any;

    expect(nodeReq.headers['x-forwarded-host']).toBe('example.com');
  });

  it('keeps an explicitly provided x-forwarded-host', async () => {
    const { createNodeRequest } = await import('./http-adapter');

    const nodeReq = (await createNodeRequest(
      buildRequest({ 'x-forwarded-host': 'custom.host.com' }),
    )) as any;

    expect(nodeReq.headers['x-forwarded-host']).toBe('custom.host.com');
  });
});

describe('createNodeRequest - scheme forcing (http APP_URL)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.doMock('@/envs/app', () => ({
      appEnv: {
        APP_URL: 'http://localhost:3010',
      },
    }));
  });

  afterEach(() => {
    vi.doUnmock('@/envs/app');
    vi.resetModules();
  });

  it('leaves socket.encrypted false and proto http when APP_URL is http', async () => {
    const { createNodeRequest } = await import('./http-adapter');

    const nodeReq = (await createNodeRequest(buildRequest())) as any;

    expect(nodeReq.socket.encrypted).toBe(false);
    expect(nodeReq.headers['x-forwarded-proto']).toBe('http');
  });
});
