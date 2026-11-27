/**
 * 飞书文档服务
 * 调用飞书 Docs API 获取文档正文内容（Markdown 格式）
 */

import { withProxy } from '@lobechat/utils/server';
import pMap from 'p-map';

const FEISHU_DOCS_API_BASE = 'https://open.feishu.cn/open-apis/docs/v1/content';
const FEISHU_WIKI_API_BASE = 'https://open.feishu.cn/open-apis/wiki/v2/spaces';

/** 飞书相关域名 */
const FEISHU_HOST_PATTERNS = [/\.feishu\.cn$/, /\.larksuite\.com$/, /\.larkenterprise\.com$/];

/** 递归列举 wiki 子节点的并发上限 */
const WIKI_LIST_CONCURRENCY = 3;

/** 飞书「请求触发频率限制」错误码 */
const RATE_LIMIT_CODE = 99991400;
/** 命中限流时的最大重试次数 */
const MAX_RATE_LIMIT_RETRIES = 4;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 指数退避 + 抖动：~0.5s, 1s, 2s, 4s */
const backoffDelay = (attempt: number) => 2 ** attempt * 500 + Math.floor(Math.random() * 250);

/** 判断响应是否为限流（HTTP 429 或响应体含限流错误码 99991400） */
const isRateLimited = (status: number, bodyOrCode: string) =>
  status === 429 ||
  bodyOrCode.includes(String(RATE_LIMIT_CODE)) ||
  bodyOrCode.includes('frequency limit');

/**
 * 请求飞书 OpenAPI 并返回解析后的 JSON（含 code/msg/data）。
 * 命中限流（HTTP 429 或 code 99991400）时按指数退避自动重试，
 * 其余错误（HTTP 非 2xx）直接抛出，业务错误码留给调用方处理。
 */
async function requestFeishuJson(url: string, userAccessToken: string): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const response = await withProxy(globalThis.fetch)(url, {
      headers: {
        'Authorization': `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (isRateLimited(response.status, body) && attempt < MAX_RATE_LIMIT_RETRIES) {
        await sleep(backoffDelay(attempt));
        continue;
      }
      throw new Error(`Feishu API error: ${response.status} ${response.statusText} - ${body}`);
    }

    const data: any = await response.json();

    // 少数情况下限流也可能以 HTTP 200 + code 形式返回
    if (data?.code === RATE_LIMIT_CODE && attempt < MAX_RATE_LIMIT_RETRIES) {
      await sleep(backoffDelay(attempt));
      continue;
    }

    return data;
  }
}

export interface FeishuDocContent {
  /** Markdown 格式的文档正文 */
  content: string;
  /** 原始 API 响应 */
  raw?: any;
}

export interface FeishuDocServiceOptions {
  /** 用户访问令牌（user_access_token） */
  userAccessToken: string;
}

/**
 * 判断 URL 是否为飞书文档 URL
 */
export function isFeishuDocUrl(url: string): boolean {
  try {
    const { hostname } = new URL(url);
    return FEISHU_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch {
    return false;
  }
}

/**
 * 从 URL 中提取 doc_token
 * 支持格式:
 *   - https://xxx.feishu.cn/docx/{doc_token}
 *   - https://xxx.feishu.cn/wiki/{wiki_token}
 *   - https://trip.larkenterprise.com/wiki/{wiki_token}
 *   - https://xxx.feishu.cn/docx/{doc_token}#段落锚点
 *   - https://trip.larkenterprise.com/wiki/{wiki_token}#文档实际token
 * 说明: wiki_token 和 docx token 均可以直接用于 docs API（已验证）
 * 对于 /wiki/{wiki_token}#xxx 格式，优先从 pathname 提取 wiki_token
 */
export function extractDocToken(url: string): string {
  try {
    const { pathname, hash } = new URL(url);
    const parts = pathname.split('/').filter(Boolean);
    const pathToken = parts.at(-1);
    // 对于 /wiki/xxx#xxx 格式，pathname 已有 token，hash 是锚点或实际 doc_token，无需使用
    if (pathToken) {
      return pathToken;
    }
    // fallback 到 hash（仅当 pathname 无 token 时使用）
    if (hash && hash.length > 1) {
      return hash.slice(1);
    }
    throw new Error(`Cannot extract token from URL: ${url}`);
  } catch {
    throw new Error(`Cannot extract token from URL: ${url}`);
  }
}

export class FeishuDocService {
  private readonly userAccessToken: string;

  constructor(options: FeishuDocServiceOptions) {
    this.userAccessToken = options.userAccessToken;
  }

  /**
   * 获取飞书文档正文（Markdown 格式）
   * 自动从 URL 提取 token，支持 wiki 和 docx URL
   */
  async getContent(url: string): Promise<FeishuDocContent> {
    const docToken = extractDocToken(url);
    return this.getContentByToken(docToken);
  }

  /**
   * 通过 doc_token 直接获取文档正文
   */
  async getContentByToken(docToken: string): Promise<FeishuDocContent> {
    const apiUrl =
      `${FEISHU_DOCS_API_BASE}?doc_token=${encodeURIComponent(docToken)}` +
      `&doc_type=docx&content_type=markdown`;

    // 命中限流会自动退避重试
    const data: any = await requestFeishuJson(apiUrl, this.userAccessToken);

    if (data.code !== 0) {
      // 特殊错误码处理，提供明确的用户提示
      if (data.code === 2889902) {
        throw new Error(
          `[权限不足] 当前身份无法访问此文档。请确认：1. 使用 user_access_token；2. 该文档已分享给当前用户。API code: ${data.code}`,
        );
      }
      if (data.code === 2889914) {
        throw new Error(`[文档不存在] doc_token 不正确或文档已被删除。API code: ${data.code}`);
      }
      if (data.code === 2889906) {
        throw new Error(`[文档已删除] 该文档已被删除。API code: ${data.code}`);
      }
      throw new Error(`Feishu docs API error: code=${data.code}, msg=${data.msg}`);
    }

    return {
      content: data.data?.content ?? '',
      raw: data,
    };
  }
}

/** wiki 节点的精简结构 */
export interface FeishuWikiNode {
  /** 节点是否还有子节点 */
  hasChild: boolean;
  /** wiki 节点 token */
  nodeToken: string;
  /** 节点所挂载的实际文档 token（docx/sheet/...），用于拉正文 */
  objToken: string;
  /** 节点对应的对象类型，如 docx / sheet / bitable / mindnote */
  objType: string;
  /** 父节点 token，根节点为 null */
  parentNodeToken: string | null;
  /** 节点标题 */
  title: string;
}

/** 可抓取正文的对象类型（仅文档类） */
const DOC_OBJ_TYPES = new Set(['docx', 'doc']);

/**
 * 飞书知识库（Wiki）服务
 * 负责从一个 wiki 链接出发，递归列举其下所有子节点
 */
export class FeishuWikiService {
  private readonly userAccessToken: string;

  constructor(options: FeishuDocServiceOptions) {
    this.userAccessToken = options.userAccessToken;
  }

  /** 该 obj_type 是否为可抓正文的文档类型 */
  static isDocNode(objType: string): boolean {
    return DOC_OBJ_TYPES.has(objType);
  }

  private async request(url: string): Promise<any> {
    // 命中限流会自动退避重试
    const data: any = await requestFeishuJson(url, this.userAccessToken);
    if (data.code !== 0) {
      if (data.code === 131006 || data.code === 1370003) {
        throw new Error(
          `[权限不足] 当前身份无法访问此知识库节点。请确认 token 拥有 wiki 读取权限，且该知识库已分享给当前用户。API code: ${data.code}`,
        );
      }
      throw new Error(`Feishu wiki API error: code=${data.code}, msg=${data.msg}`);
    }
    return data.data;
  }

  /** 拉取 wiki 节点原始数据（含 space_id） */
  private async fetchNodeRaw(token: string): Promise<any> {
    const apiUrl = `${FEISHU_WIKI_API_BASE}/get_node?token=${encodeURIComponent(token)}`;
    const data = await this.request(apiUrl);
    const node = data?.node;
    if (!node) throw new Error(`Feishu wiki node not found for token: ${token}`);
    return node;
  }

  private mapNode(node: any, parentNodeToken: string | null): FeishuWikiNode {
    return {
      hasChild: !!node.has_child,
      nodeToken: node.node_token,
      objToken: node.obj_token,
      objType: node.obj_type,
      parentNodeToken,
      title: node.title ?? '',
    };
  }

  /**
   * 获取单个 wiki 节点信息
   */
  async getNode(token: string): Promise<FeishuWikiNode> {
    const node = await this.fetchNodeRaw(token);
    return this.mapNode(node, node.parent_node_token || null);
  }

  /**
   * 列举某父节点下的直接子节点（自动翻页）
   */
  async listChildren(spaceId: string, parentNodeToken: string): Promise<FeishuWikiNode[]> {
    const result: FeishuWikiNode[] = [];
    let pageToken: string | undefined;

    do {
      const params = new URLSearchParams({
        page_size: '50',
        parent_node_token: parentNodeToken,
      });
      if (pageToken) params.set('page_token', pageToken);

      const apiUrl = `${FEISHU_WIKI_API_BASE}/${encodeURIComponent(spaceId)}/nodes?${params.toString()}`;
      const data = await this.request(apiUrl);

      for (const node of data?.items ?? []) {
        result.push(this.mapNode(node, parentNodeToken));
      }

      pageToken = data?.has_more ? data?.page_token : undefined;
    } while (pageToken);

    return result;
  }

  /**
   * 从 wiki 链接出发，递归列举其下所有节点（含根节点本身）。
   * 返回扁平列表，节点间通过 parentNodeToken 表达层级关系。
   */
  async listAllNodes(url: string): Promise<FeishuWikiNode[]> {
    const rootToken = extractDocToken(url);
    const rootRaw = await this.fetchNodeRaw(rootToken);
    const spaceId = rootRaw.space_id;
    if (!spaceId) throw new Error(`Cannot resolve space_id for wiki token: ${rootToken}`);

    const root = this.mapNode(rootRaw, rootRaw.parent_node_token || null);
    const all: FeishuWikiNode[] = [root];

    const walk = async (node: FeishuWikiNode): Promise<void> => {
      if (!node.hasChild) return;
      const children = await this.listChildren(spaceId, node.nodeToken);
      all.push(...children);
      await pMap(
        children.filter((child) => child.hasChild),
        (child) => walk(child),
        { concurrency: WIKI_LIST_CONCURRENCY },
      );
    };

    await walk(root);
    return all;
  }
}
