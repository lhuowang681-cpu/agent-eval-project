import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OUTBOUND_PROXY_ENV = 'CRAWLER_PROXY_URI';

describe('withProxy', () => {
  const originalProxyUri = process.env[OUTBOUND_PROXY_ENV];

  beforeEach(() => {
    vi.resetModules();
    delete process.env[OUTBOUND_PROXY_ENV];
  });

  afterEach(() => {
    if (originalProxyUri) {
      process.env[OUTBOUND_PROXY_ENV] = originalProxyUri;
      return;
    }

    delete process.env[OUTBOUND_PROXY_ENV];
  });

  it('should bypass proxy for ctripcorp hosts', async () => {
    const { withProxy } = await import('./withProxy');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null)) as unknown as typeof fetch;
    const init = { headers: { 'x-test': '1' } };

    await withProxy(fetchImpl)('https://foo.ctripcorp.com/api', init);

    expect(fetchImpl).toHaveBeenCalledWith('https://foo.ctripcorp.com/api', init);
  });

  it('should bypass proxy for tripqate hosts', async () => {
    const { withProxy } = await import('./withProxy');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null)) as unknown as typeof fetch;
    const init = { headers: { 'x-test': '1' } };

    await withProxy(fetchImpl)('http://ticket.fws.tripqate.com/api/mcp', init);

    expect(fetchImpl).toHaveBeenCalledWith('http://ticket.fws.tripqate.com/api/mcp', init);
  });

  it('should keep proxy for non-ctripcorp hosts', async () => {
    process.env[OUTBOUND_PROXY_ENV] = 'http://127.0.0.1:9000';

    const { withProxy } = await import('./withProxy');
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null)) as unknown as typeof fetch;

    await withProxy(fetchImpl)('https://example.com/api');

    const [, init] = vi.mocked(fetchImpl).mock.calls[0];

    expect(init).toEqual(expect.objectContaining({ dispatcher: expect.anything() }));
  });
});
