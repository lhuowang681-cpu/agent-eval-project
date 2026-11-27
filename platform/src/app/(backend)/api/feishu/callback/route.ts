import { FEISHU_OAUTH_RESULT_STORAGE_KEY } from '@/const/feishuOAuth';

/**
 * 飞书授权回调页。
 *
 * 飞书带着 `?code=&state=` 跳回**本站同源**的这个地址；这里不换票（换票要
 * app_secret，走 tRPC `feishuAuth.exchangeCode`），只把授权码交回发起页。
 *
 * 交接方式是同源 localStorage，理由见 `src/const/feishuOAuth.ts` 的注释：
 * `window.open(url, '_blank', 'noopener')` 会把 `window.opener` 置空，postMessage
 * 那条路走不通；而在服务端存 state→code 的中间态，会在多实例部署下因为回调
 * 落到另一个实例而静默失效。localStorage 两头同源，且完全无服务端状态。
 *
 * 授权码本身是**一次性**的，且随即被发起页消费掉，落在 localStorage 的时间窗很短。
 */

export const runtime = 'nodejs';

const renderHtml = ({ message, payload }: { message: string; payload: unknown }) => `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>飞书授权</title>
    <style>
      body {
        align-items: center;
        display: flex;
        font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
        height: 100vh;
        justify-content: center;
        margin: 0;
      }
      p { color: #444; font-size: 15px; }
      @media (prefers-color-scheme: dark) {
        body { background: #1a1a1a; }
        p { color: #bbb; }
      }
    </style>
  </head>
  <body>
    <p>${message}</p>
    <script>
      (function () {
        try {
          localStorage.setItem(
            ${JSON.stringify(FEISHU_OAUTH_RESULT_STORAGE_KEY)},
            ${JSON.stringify(JSON.stringify(payload))}
          );
        } catch (e) {
          // localStorage 不可用（隐私模式等）——发起页会走超时分支给出可读报错
        }
        // 给发起页一点时间读走结果，再尝试自关（非脚本打开的标签页关不掉，属正常）
        setTimeout(function () { window.close(); }, 800);
      })();
    </script>
  </body>
</html>`;

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const succeeded = !!code && !error;

  const payload = succeeded
    ? { code, state, status: 'success' }
    : {
        error: error ?? 'missing_code',
        errorDescription: errorDescription ?? undefined,
        state,
        status: 'error',
      };

  const html = renderHtml({
    message: succeeded ? '授权成功，正在返回…' : `授权失败：${errorDescription ?? error ?? '未拿到授权码'}`,
    payload: { ...payload, receivedAt: Date.now() },
  });

  return new Response(html, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'text/html; charset=utf-8',
    },
    status: succeeded ? 200 : 400,
  });
};
