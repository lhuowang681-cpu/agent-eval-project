/**
 * Local stub for `@ctrip/lark-auth/browser`.
 *
 * Feishu (Lark) OAuth needs to reach Feishu's servers, which is impossible offline.
 * The class constructs fine so module-level wiring in `src/services/feishuToken.ts`
 * does not explode on import; the token methods throw when actually invoked.
 */

export interface LarkAuthOptions {
  appId: string;
  appSecret?: string;
  scope?: string;
  storageType?: 'localStorage' | 'sessionStorage' | string;
  [key: string]: unknown;
}

export type RequestTokenResult =
  | { status: 'ready'; token: string }
  | { status: 'auth_required'; authUrl: string };

const unavailable = (what: string): never => {
  throw new Error(
    `[stub] @ctrip/lark-auth ${what} is unavailable offline. Feishu login is disabled.`,
  );
};

export class LarkAuth {
  constructor(_options: LarkAuthOptions) {}

  async requestUserAccessToken(): Promise<RequestTokenResult> {
    return unavailable('requestUserAccessToken');
  }

  async completeAuthorization(_params?: unknown): Promise<RequestTokenResult> {
    return unavailable('completeAuthorization');
  }
}

export default { LarkAuth };
