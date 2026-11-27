import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useErrorContent } from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue,
  }),
}));

vi.mock('@/business/client/hooks/useBusinessErrorAlertConfig', () => ({
  default: () => undefined,
}));

vi.mock('@/business/client/hooks/useBusinessErrorContent', () => ({
  default: () => ({}),
}));

vi.mock('@/business/client/hooks/useRenderBusinessChatErrorMessageExtra', () => ({
  default: () => undefined,
}));

vi.mock('@/hooks/useProviderName', () => ({
  useProviderName: (provider: string) => provider,
}));

vi.mock('@/features/Conversation/ChatItem/components/ErrorContent', () => ({
  default: () => null,
}));

vi.mock('./ChatInvalidApiKey', () => ({
  default: () => null,
}));

vi.mock('./NoCodingPlanError', () => ({
  default: () => null,
}));

vi.mock('@lobehub/ui', () => ({
  Block: ({ children }: { children?: unknown }) => children,
  Highlighter: ({ children }: { children?: unknown }) => children,
  Skeleton: { Button: () => null },
}));

describe('useErrorContent', () => {
  it('returns Peta access authorization guidance when tripflow bindKey error is wrapped as 500', () => {
    const { result } = renderHook(() =>
      useErrorContent(
        {
          body: {
            error: {
              message: JSON.stringify({
                apikey: null,
                code: '404',
                endpoint: null,
                message:
                  'No binding found for this appId and keyName. Call bindKey first so this app can use this keyName.',
                tags: null,
              }),
              name: 'Error',
            },
            provider: 'tripflow',
          },
          message: '服务器内部错误，请稍后再试',
          type: 500,
        },
        { model: 'claude-sonnet-4-6', provider: 'tripflow' },
      ),
    );

    expect(result.current?.message).toBe(
      '【Peta｜claude-sonnet-4-6】 Peta未申请访问授权，需要 Peta Key Owner 在 Peta 上申请应用访问权限。操作路径：租户管理 -> 选择目标租户 -> API Key 管理 -> 访问授权；环境选择 Captain 应用，APPID 填写 100071558。',
    );
  });
});
