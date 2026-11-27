import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLLMConfig } from '@/envs/llm';

import {
  ADA_CODING_PLAN_REQUIRED_MESSAGE,
  ADA_GATEWAY_UNAVAILABLE_MESSAGE,
  AdaTokenService,
} from './index';

vi.mock('@/envs/llm', () => ({
  getLLMConfig: vi.fn(),
}));

describe('AdaTokenService', () => {
  const userId = 'user-1';
  const mockDb = {
    query: {
      users: {
        findFirst: vi.fn(),
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getLLMConfig).mockReturnValue({
      ADA_APP_ID: 'app-id',
      ADA_APP_SECRET: 'app-secret',
    } as ReturnType<typeof getLLMConfig>);
    vi.mocked(mockDb.query.users.findFirst).mockResolvedValue({ username: 'e12345' });
    new AdaTokenService(mockDb as never).clearCache();
  });

  it('throws NoCodingPlanError when exchange HTTP status is 4xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '目标用户未生效 Coding Plan 套餐' }), {
        status: 403,
      }),
    );

    const service = new AdaTokenService(mockDb as never);

    await expect(service.exchangeToken(userId)).rejects.toMatchObject({
      message: '目标用户未生效 Coding Plan 套餐',
      name: 'NoCodingPlanError',
    });
  });

  it('throws NoCodingPlanError with default message when 4xx body is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 403 }));

    const service = new AdaTokenService(mockDb as never);

    await expect(service.exchangeToken(userId)).rejects.toMatchObject({
      message: ADA_CODING_PLAN_REQUIRED_MESSAGE,
      name: 'NoCodingPlanError',
    });
  });

  it('throws AdaGatewayError when exchange HTTP status is 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('upstream failed', { status: 503 }),
    );

    const service = new AdaTokenService(mockDb as never);

    await expect(service.exchangeToken(userId)).rejects.toMatchObject({
      cause: 'upstream failed',
      name: 'AdaGatewayError',
    });
  });

  it('throws AdaGatewayError with default message when 5xx body is empty', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 502 }));

    const service = new AdaTokenService(mockDb as never);

    await expect(service.exchangeToken(userId)).rejects.toMatchObject({
      cause: ADA_GATEWAY_UNAVAILABLE_MESSAGE,
      name: 'AdaGatewayError',
    });
  });

  it('throws NoCodingPlanError when success is false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: '套餐未开通', success: false }), { status: 200 }),
    );

    const service = new AdaTokenService(mockDb as never);

    await expect(service.exchangeToken(userId)).rejects.toMatchObject({
      message: '套餐未开通',
      name: 'NoCodingPlanError',
    });
  });
});
