import { type SSOProvider } from '@lobechat/types';

import { type StoreSetter } from '@/store/types';

import { type UserStore } from '../../store';

interface AuthProvidersData {
  hasPasswordAccount: boolean;
  providers: SSOProvider[];
}

const fetchAuthProvidersData = async (): Promise<AuthProvidersData> => {
  // 生产环境：只使用 ctrip SSO，登录方式区块已隐藏，无需查询绑定的账户列表。
  // 跳过 listAccounts 调用，直接返回空结果。
  if (process.env.NODE_ENV === 'production') {
    return { hasPasswordAccount: false, providers: [] };
  }

  const { accountInfo, listAccounts } = await import('@/libs/better-auth/auth-client');
  const result = await listAccounts();
  const accounts = result.data || [];
  const hasPasswordAccount = accounts.some((account) => account.providerId === 'credential');
  const providers = await Promise.all(
    accounts
      .filter((account) => account.providerId !== 'credential')
      .map(async (account) => {
        // In theory, the id_token could be decrypted from the accounts table, but I found that better-auth on GitHub does not save the id_token
        const info = await accountInfo({
          query: { accountId: account.accountId },
        });
        return {
          email: info.data?.user?.email ?? undefined,
          provider: account.providerId,
          providerAccountId: account.accountId,
        };
      }),
  );
  return { hasPasswordAccount, providers };
};

type Setter = StoreSetter<UserStore>;
export const createAuthSlice = (set: Setter, get: () => UserStore, _api?: unknown) =>
  new UserAuthActionImpl(set, get, _api);

export class UserAuthActionImpl {
  readonly #get: () => UserStore;
  readonly #set: Setter;

  constructor(set: Setter, get: () => UserStore, _api?: unknown) {
    void _api;
    this.#set = set;
    this.#get = get;
  }

  fetchAuthProviders = async (): Promise<void> => {
    // Skip if already loaded
    if (this.#get().isLoadedAuthProviders) return;

    try {
      const { hasPasswordAccount, providers } = await fetchAuthProvidersData();
      this.#set({ authProviders: providers, hasPasswordAccount, isLoadedAuthProviders: true });
    } catch (error) {
      console.error('Failed to fetch auth providers:', error);
      this.#set({ isLoadedAuthProviders: true });
    }
  };

  logout = async (): Promise<void> => {
    const { signOut } = await import('@/libs/better-auth/auth-client');
    await signOut({
      fetchOptions: {
        onSuccess: async () => {
          // better-auth signOut 只清了自己的 session cookie，
          // OIDC provider 的 _session cookie 需要单独清，否则下次
          // 桌面端走 OIDC 授权时浏览器会带上旧账号的 session，
          // 导致 OIDC provider 报 "accountId mismatch"。
          // 同源 fetch 会带上 OIDC cookie，OIDC end_session 响应头的
          // Set-Cookie(_session=; expires=Thu, 01 Jan 1970) 会清掉它。
          try {
            await fetch(
              '/oidc/session/end?post_logout_redirect_uri=' + encodeURIComponent('/signin'),
              {
                credentials: 'include',
                method: 'GET',
              },
            );
          } catch {
            // OIDC 清理失败不阻塞退出
          }
          // Use window.location.href to trigger a full page reload
          // This ensures all client-side state (React, Zustand, cache) is cleared
          window.location.href = '/signin';
        },
      },
    });
  };

  openLogin = async (): Promise<void> => {
    // Skip if already on a login page (/signin, /signup)
    const pathname = location.pathname;
    if (pathname.startsWith('/signin') || pathname.startsWith('/signup')) {
      return;
    }

    const currentUrl = location.toString();
    window.location.href = `/signin?callbackUrl=${encodeURIComponent(currentUrl)}`;
  };

  refreshAuthProviders = async (): Promise<void> => {
    try {
      const { hasPasswordAccount, providers } = await fetchAuthProvidersData();
      this.#set({ authProviders: providers, hasPasswordAccount });
    } catch (error) {
      console.error('Failed to refresh auth providers:', error);
    }
  };
}

export type UserAuthAction = Pick<UserAuthActionImpl, keyof UserAuthActionImpl>;
