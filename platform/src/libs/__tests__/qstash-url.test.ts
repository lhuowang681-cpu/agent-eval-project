// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the SDK modules so importing @/libs/qstash doesn't require real env vars.
vi.mock('@ctrip/qstash', () => ({
  Client: vi
    .fn()
    .mockImplementation(() => ({ messages: { delete: vi.fn() }, publishJSON: vi.fn() })),
  Receiver: vi.fn().mockImplementation(() => ({ verify: vi.fn() })),
}));
vi.mock('@ctrip/qworkflow', () => ({
  Client: vi.fn().mockImplementation(() => ({ cancel: vi.fn(), trigger: vi.fn() })),
}));

const { resolveWebhookUrl, assertPublicDeliveryUrl } = await import('@/libs/qstash');

describe('resolveWebhookUrl', () => {
  beforeEach(() => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_URL', 'https://calcifer.fat0.tripqate.com');
    vi.stubEnv('INTERNAL_APP_URL', 'http://localhost:8080');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns absolute URLs unchanged (qstash)', () => {
    expect(resolveWebhookUrl('https://other.example.com/hook', 'qstash')).toBe(
      'https://other.example.com/hook',
    );
  });

  it('returns absolute URLs unchanged (fetch)', () => {
    expect(resolveWebhookUrl('https://other.example.com/hook', 'fetch')).toBe(
      'https://other.example.com/hook',
    );
  });

  it('joins relative URL with public APP_URL for qstash delivery', () => {
    expect(resolveWebhookUrl('/api/workflows/task/on-topic-complete', 'qstash')).toBe(
      'https://calcifer.fat0.tripqate.com/api/workflows/task/on-topic-complete',
    );
  });

  it('does NOT use INTERNAL_APP_URL for qstash delivery even when set to localhost', () => {
    // Regression guard: the bug was qstash targets resolving to http://localhost:8080
    expect(resolveWebhookUrl('/api/workflows/task/on-topic-complete', 'qstash')).not.toContain(
      'localhost',
    );
    expect(resolveWebhookUrl('/api/workflows/task/on-topic-complete', 'qstash')).not.toContain(
      '8080',
    );
  });

  it('joins relative URL with INTERNAL_APP_URL for fetch delivery (self-call bypass)', () => {
    expect(resolveWebhookUrl('/api/internal/memory/hourly', 'fetch')).toBe(
      'http://localhost:8080/api/internal/memory/hourly',
    );
  });

  it('falls back to APP_URL for fetch when INTERNAL_APP_URL is unset', () => {
    vi.stubEnv('INTERNAL_APP_URL', '');
    expect(resolveWebhookUrl('/api/internal/memory/hourly', 'fetch')).toBe(
      'https://calcifer.fat0.tripqate.com/api/internal/memory/hourly',
    );
  });

  it('defaults to fetch delivery when delivery omitted', () => {
    // fetch is the default; with INTERNAL_APP_URL set it should use it
    expect(resolveWebhookUrl('/api/internal/memory/hourly')).toBe(
      'http://localhost:8080/api/internal/memory/hourly',
    );
  });
});

describe('assertPublicDeliveryUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('allows localhost in development', () => {
    vi.stubEnv('NODE_ENV', 'development');
    expect(() => assertPublicDeliveryUrl('http://localhost:3010/api/agent/run')).not.toThrow();
  });

  it('throws on localhost target in non-dev (regression guard for the FAT bug)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() =>
      assertPublicDeliveryUrl('http://localhost:8080/api/workflows/task/on-topic-complete'),
    ).toThrow(/localhost/);
  });

  it('throws on 127.0.0.1 target in non-dev', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertPublicDeliveryUrl('http://127.0.0.1:3010/api/agent/run')).toThrow();
  });

  it('allows a public URL in non-dev', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() =>
      assertPublicDeliveryUrl(
        'https://calcifer.fat0.tripqate.com/api/workflows/task/on-topic-complete',
      ),
    ).not.toThrow();
  });

  it('does not throw on an unparseable URL (let downstream handle it)', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => assertPublicDeliveryUrl('not-a-url')).not.toThrow();
  });
});
