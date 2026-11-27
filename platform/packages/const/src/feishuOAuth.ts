/**
 * 飞书 OAuth 端点与常量。
 *
 * 单独抽出来是因为有两条链路都要用：
 *   1. `src/libs/better-auth/sso/providers/feishu.ts` —— 站点登录（SSO）
 *   2. `src/server/services/feishuOAuth` —— 飞书 MCP 的 user_access_token
 *
 * 两条链路共用同一个飞书应用凭证（`AUTH_FEISHU_APP_ID` / `AUTH_FEISHU_APP_SECRET`），
 * URL 常量必须保持一致，故集中一处。
 */

export const FEISHU_AUTHORIZATION_URL = 'https://accounts.feishu.cn/open-apis/authen/v1/authorize';
export const FEISHU_TOKEN_URL = 'https://open.feishu.cn/open-apis/authen/v2/oauth/token';
export const FEISHU_USERINFO_URL = 'https://open.feishu.cn/open-apis/authen/v1/user_info';

/** 授权回调路径（同源后端路由，见 `src/app/(backend)/api/feishu/callback/route.ts`） */
export const FEISHU_OAUTH_CALLBACK_PATH = '/api/feishu/callback';

/**
 * 回调页与发起页之间交接授权码结果所用的 localStorage 键。
 *
 * 回调路由与应用**同源**，因此回调页写入的 localStorage 发起页能直接读到 ——
 * 无需 `window.opener`（`window.open(..., 'noopener')` 会把 opener 置空），
 * 也无需服务端保存 state→code 的中间态（那样在多实例部署下会因为
 * 请求落到另一个实例而静默失效）。
 */
export const FEISHU_OAUTH_RESULT_STORAGE_KEY = 'calcifer:feishu-oauth-result';
