import { useCallback, useState } from 'react';

import { feishuTokenService } from '@/services/feishuToken';

export const useFeishuAuthorize = () => {
  const [isAuthorizing, setIsAuthorizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorize = useCallback(async (authUrl: string): Promise<string | null> => {
    setIsAuthorizing(true);
    setError(null);

    try {
      feishuTokenService.openAuthPage(authUrl);
      const token = await feishuTokenService.completeAuthorization();
      return token;
    } catch (err) {
      const message = (err as Error).message || 'Feishu authorization failed';
      setError(message);
      setIsAuthorizing(false);
      return null;
    }
  }, []);

  return { authorize, error, isAuthorizing };
};
