import { useUserStore } from '@/store/user';
import { authSelectors, userProfileSelectors } from '@/store/user/slices/auth/selectors';

export const useIsMarketPublisher = (publisherId?: string) => {
  const isLogin = useUserStore(authSelectors.isLogin);
  const currentUserId = useUserStore(userProfileSelectors.userId);

  return Boolean(isLogin && publisherId && currentUserId === publisherId);
};
