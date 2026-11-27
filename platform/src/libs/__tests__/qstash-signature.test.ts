// @vitest-environment node
import { createHmac } from 'node:crypto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { verifyQStashSignature } from '@/libs/qstash';

// We need to mock the module-level side effects (Client/WorkflowClient construction)
// since ZXQSTASH_TOKEN may not be available in test environment
vi.mock('@ctrip/qstash', () => ({
  Client: vi.fn().mockImplementation(() => ({
    messages: { delete: vi.fn() },
    publishJSON: vi.fn(),
  })),
  Receiver: vi.fn().mockImplementation(({ currentSigningKey, nextSigningKey }) => ({
    verify: vi.fn().mockImplementation(async ({ body, signature }) => {
      // Simple mock: signature is valid if it matches expected format
      if (!signature || !signature.startsWith('v1:')) return false;
      const parts = signature.split(':');
      if (parts.length !== 3) return false;
      const timestamp = parseInt(parts[1], 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestamp) > 300) return false;

      const messageToSign = `${parts[1]}.${body}`;
      const expected = createHmac('sha256', currentSigningKey).update(messageToSign).digest('hex');
      if (parts[2] === expected) return true;

      if (nextSigningKey) {
        const nextExpected = createHmac('sha256', nextSigningKey)
          .update(messageToSign)
          .digest('hex');
        if (parts[2] === nextExpected) return true;
      }
      return false;
    }),
  })),
}));

vi.mock('@ctrip/qworkflow', () => ({
  Client: vi.fn().mockImplementation(() => ({
    cancel: vi.fn(),
    trigger: vi.fn(),
  })),
}));

const CURRENT_KEY = 'test-current-signing-key';
const NEXT_KEY = 'test-next-signing-key';

function generateSignature(payload: string, signingKey: string): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const messageToSign = `${timestamp}.${payload}`;
  const sig = createHmac('sha256', signingKey).update(messageToSign).digest('hex');
  return `v1:${timestamp}:${sig}`;
}

describe('verifyQStashSignature', () => {
  beforeEach(() => {
    vi.stubEnv('ZXQSTASH_CURRENT_SIGNING_KEY', CURRENT_KEY);
    vi.stubEnv('ZXQSTASH_NEXT_SIGNING_KEY', NEXT_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts X-ZxQstash-Signature header (@ctrip format)', async () => {
    const body = '{"event":"test"}';
    const signature = generateSignature(body, CURRENT_KEY);

    const request = new Request('https://app.example.com/webhook', {
      headers: { 'X-ZxQstash-Signature': signature },
    });

    const result = await verifyQStashSignature(request, body);
    expect(result).toBe(true);
  });

  it('accepts Upstash-Signature header (legacy format)', async () => {
    const body = '{"event":"legacy"}';
    const signature = generateSignature(body, CURRENT_KEY);

    const request = new Request('https://app.example.com/webhook', {
      headers: { 'Upstash-Signature': signature },
    });

    const result = await verifyQStashSignature(request, body);
    expect(result).toBe(true);
  });

  it('prefers X-ZxQstash-Signature over Upstash-Signature when both present', async () => {
    const body = '{"event":"both"}';
    const validSignature = generateSignature(body, CURRENT_KEY);
    const invalidSignature = 'v1:12345:invalid';

    const request = new Request('https://app.example.com/webhook', {
      headers: {
        'Upstash-Signature': invalidSignature,
        'X-ZxQstash-Signature': validSignature,
      },
    });

    const result = await verifyQStashSignature(request, body);
    expect(result).toBe(true);
  });

  it('returns false when no signing keys are configured', async () => {
    vi.unstubAllEnvs();

    const request = new Request('https://app.example.com/webhook', {
      headers: { 'X-ZxQstash-Signature': 'v1:12345:abc' },
    });

    const result = await verifyQStashSignature(request, '{}');
    expect(result).toBe(false);
  });

  it('returns false when no signature header is present', async () => {
    const request = new Request('https://app.example.com/webhook');

    const result = await verifyQStashSignature(request, '{}');
    expect(result).toBe(false);
  });
});
