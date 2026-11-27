import { ProxyAgent } from 'undici';

/** 出站 HTTP 代理 URI；不同部署环境由用户自行在环境里配置不同值 */
const CRAWLER_PROXY_URI = 'CRAWLER_PROXY_URI';
// tripqate.com hosts internal MCP services such as train-voice-mcp; route them directly.
const DIRECT_HOSTS = ['ctripcorp.com', 'tripqate.com'] as const;

function readRequiredOutboundProxyUri(): string {
  const value = process.env[CRAWLER_PROXY_URI]?.trim();
  if (!value) {
    throw new Error(
      `Missing required environment variable ${CRAWLER_PROXY_URI} for web crawler outbound HTTP proxy.`,
    );
  }
  return value;
}

/** 当前进程配置的出站代理 URI（`WEB_CRAWLER_OUTBOUND_PROXY_URI`） */
export function getWebCrawlerOutboundProxyUri(): string {
  return readRequiredOutboundProxyUri();
}

let outboundProxyDispatcher: ProxyAgent | undefined;

function getOutboundProxyDispatcher(): ProxyAgent {
  if (!outboundProxyDispatcher) {
    outboundProxyDispatcher = new ProxyAgent({ uri: getWebCrawlerOutboundProxyUri() });
  }
  return outboundProxyDispatcher;
}

function resolveRequestUrl(input: RequestInfo | URL): URL | undefined {
  if (input instanceof URL) return input;

  if (input instanceof Request) {
    return new URL(input.url);
  }

  if (typeof input !== 'string') return undefined;

  try {
    return new URL(input);
  } catch {
    return undefined;
  }
}

function shouldBypassProxy(input: RequestInfo | URL): boolean {
  const hostname = resolveRequestUrl(input)?.hostname.toLowerCase();

  if (!hostname) return false;

  return DIRECT_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}

/**
 * 包装 fetch，使请求经出站代理（URI 由环境变量 `WEB_CRAWLER_OUTBOUND_PROXY_URI` 指定）。
 */
export const withProxy = (fetchImpl: typeof fetch): typeof fetch => {
  return (input, init) => {
    if (shouldBypassProxy(input)) {
      return fetchImpl(input, init);
    }

    return fetchImpl(input, {
      ...init,
      dispatcher: getOutboundProxyDispatcher(),
    } as RequestInit);
  };
};
