// @vitest-environment node
import { createHmac } from 'node:crypto';

import { Receiver } from '@ctrip/qstash';
import { beforeEach, describe, expect, it } from 'vitest';

/**
 * Helper to generate a valid signature for testing
 * Format: v1:{timestamp}:{hex_signature}
 */
function generateTestSignature(
  payload: string,
  signingKey: string,
  timestampOffsetSeconds = 0,
): string {
  const timestamp = Math.floor(Date.now() / 1000) + timestampOffsetSeconds;
  const messageToSign = `${timestamp}.${payload}`;
  const signature = createHmac('sha256', signingKey).update(messageToSign).digest('hex');
  return `v1:${timestamp}:${signature}`;
}

describe('@ctrip/qstash Receiver', () => {
  const CURRENT_KEY = 'test-current-signing-key';
  const NEXT_KEY = 'test-next-signing-key';

  describe('constructor', () => {
    it('creates receiver with currentSigningKey', () => {
      const receiver = new Receiver({ currentSigningKey: CURRENT_KEY });
      expect(receiver).toBeInstanceOf(Receiver);
    });

    it('creates receiver with both keys (key rotation)', () => {
      const receiver = new Receiver({
        currentSigningKey: CURRENT_KEY,
        nextSigningKey: NEXT_KEY,
      });
      expect(receiver).toBeInstanceOf(Receiver);
    });

    it('throws when currentSigningKey is empty', () => {
      expect(() => new Receiver({ currentSigningKey: '' })).toThrow(
        'currentSigningKey is required',
      );
    });
  });

  describe('verify', () => {
    let receiver: Receiver;

    beforeEach(() => {
      receiver = new Receiver({
        currentSigningKey: CURRENT_KEY,
        nextSigningKey: NEXT_KEY,
      });
    });

    it('returns true for valid signature with current key', async () => {
      const body = '{"event":"test","data":{"id":1}}';
      const signature = generateTestSignature(body, CURRENT_KEY);

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(true);
    });

    it('returns true for valid signature with next key (key rotation)', async () => {
      const body = '{"event":"rotation"}';
      const signature = generateTestSignature(body, NEXT_KEY);

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(true);
    });

    it('returns false for empty signature', async () => {
      const result = await receiver.verify({ body: 'test', signature: '' });
      expect(result).toBe(false);
    });

    it('returns false for invalid signature format', async () => {
      const result = await receiver.verify({
        body: 'test',
        signature: 'invalid-format',
      });
      expect(result).toBe(false);
    });

    it('returns false for wrong signing key', async () => {
      const body = '{"event":"wrong-key"}';
      const signature = generateTestSignature(body, 'wrong-key');

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(false);
    });

    it('returns false for expired timestamp (> 5 minutes)', async () => {
      const body = '{"event":"expired"}';
      // 6 minutes ago (exceeds 5-minute window)
      const signature = generateTestSignature(body, CURRENT_KEY, -360);

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(false);
    });

    it('returns false for future timestamp (> 5 minutes)', async () => {
      const body = '{"event":"future"}';
      // 6 minutes in the future
      const signature = generateTestSignature(body, CURRENT_KEY, 360);

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(false);
    });

    it('accepts signature within 5-minute window', async () => {
      const body = '{"event":"within-window"}';
      // 2 minutes ago
      const signature = generateTestSignature(body, CURRENT_KEY, -120);

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(true);
    });

    it('returns false for tampered body', async () => {
      const originalBody = '{"event":"original"}';
      const signature = generateTestSignature(originalBody, CURRENT_KEY);

      const result = await receiver.verify({
        body: '{"event":"tampered"}',
        signature,
      });
      expect(result).toBe(false);
    });

    it('returns false for v2 signature version', async () => {
      const result = await receiver.verify({
        body: 'test',
        signature: 'v2:12345:abcdef',
      });
      expect(result).toBe(false);
    });
  });

  describe('receiver without nextSigningKey', () => {
    it('only verifies against current key', async () => {
      const receiver = new Receiver({ currentSigningKey: CURRENT_KEY });
      const body = '{"event":"single-key"}';
      const signature = generateTestSignature(body, CURRENT_KEY);

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(true);
    });

    it('rejects signatures from unknown key', async () => {
      const receiver = new Receiver({ currentSigningKey: CURRENT_KEY });
      const body = '{"event":"unknown-key"}';
      const signature = generateTestSignature(body, NEXT_KEY);

      const result = await receiver.verify({ body, signature });
      expect(result).toBe(false);
    });
  });
});
