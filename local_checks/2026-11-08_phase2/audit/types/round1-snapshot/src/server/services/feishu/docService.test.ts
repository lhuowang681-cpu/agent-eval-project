import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FeishuDocService, FeishuWikiService } from './docService';

// withProxy 直接透传，便于直接 stub globalThis.fetch
vi.mock('@lobechat/utils/server', () => ({
  withProxy: (fn: typeof fetch) => fn,
}));

/**
 * 构造一棵 mock 的 wiki 节点树：
 *
 * root (V8k, docx, has_child)
 *   ├─ A  (docx, leaf)            // page1
 *   ├─ B  (docx, has_child)       // page1
 *   │    ├─ B1 (docx, leaf)
 *   │    └─ B2 (sheet, leaf)      // 非文档类型
 *   └─ C  (docx, leaf)            // page2（翻页才拿得到）
 */
const SPACE_ID = 'space-1';

const NODE = {
  A: { has_child: false, node_token: 'A', obj_token: 'oA', obj_type: 'docx', title: 'A' },
  B: { has_child: true, node_token: 'B', obj_token: 'oB', obj_type: 'docx', title: 'B' },
  B1: { has_child: false, node_token: 'B1', obj_token: 'oB1', obj_type: 'docx', title: 'B1' },
  B2: { has_child: false, node_token: 'B2', obj_token: 'oB2', obj_type: 'sheet', title: 'B2' },
  C: { has_child: false, node_token: 'C', obj_token: 'oC', obj_type: 'docx', title: 'C' },
  root: {
    has_child: true,
    node_token: 'V8k',
    obj_token: 'oRoot',
    obj_type: 'docx',
    space_id: SPACE_ID,
    title: 'root',
  },
};

const ok = (data: any) => ({
  json: async () => ({ code: 0, data }),
  ok: true,
  status: 200,
  statusText: 'OK',
});

const fetchImpl = async (rawUrl: string) => {
  const url = new URL(rawUrl);
  const params = url.searchParams;

  // get_node?token=xxx
  if (url.pathname.endsWith('/get_node')) {
    const token = params.get('token');
    const map: Record<string, any> = { B: NODE.B, V8k: NODE.root };
    return ok({ node: map[token!] }) as any;
  }

  // /{space}/nodes?parent_node_token=xxx[&page_token=p2]
  if (url.pathname.endsWith('/nodes')) {
    const parent = params.get('parent_node_token');
    const pageToken = params.get('page_token');

    if (parent === 'V8k') {
      // 根的子节点分两页：page1 = [A, B] 且 has_more，page2 = [C]
      if (!pageToken) {
        return ok({ has_more: true, items: [NODE.A, NODE.B], page_token: 'p2' }) as any;
      }
      return ok({ has_more: false, items: [NODE.C] }) as any;
    }

    if (parent === 'B') {
      return ok({ has_more: false, items: [NODE.B1, NODE.B2] }) as any;
    }

    return ok({ has_more: false, items: [] }) as any;
  }

  throw new Error(`unexpected url: ${rawUrl}`);
};

describe('FeishuWikiService.listAllNodes', () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchSpy = vi.fn(fetchImpl);
    vi.stubGlobal('fetch', fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  const service = () => new FeishuWikiService({ userAccessToken: 'token-1' });

  it('递归列举出整棵树的所有节点（含根、含翻页、含非文档节点）', async () => {
    const nodes = await service().listAllNodes('https://trip.larkenterprise.com/wiki/V8k');

    const tokens = nodes.map((n) => n.nodeToken).sort();
    // 6 个节点：root + A + B + C + B1 + B2，一个都不能漏
    expect(tokens).toEqual(['A', 'B', 'B1', 'B2', 'C', 'V8k']);
  });

  it('每个节点的 parentNodeToken 指向正确的父节点', async () => {
    const nodes = await service().listAllNodes('https://trip.larkenterprise.com/wiki/V8k');
    const byToken = Object.fromEntries(nodes.map((n) => [n.nodeToken, n]));

    expect(byToken['V8k'].parentNodeToken).toBeNull();
    expect(byToken['A'].parentNodeToken).toBe('V8k');
    expect(byToken['B'].parentNodeToken).toBe('V8k');
    expect(byToken['C'].parentNodeToken).toBe('V8k'); // 翻页拿到的也要挂对父
    expect(byToken['B1'].parentNodeToken).toBe('B');
    expect(byToken['B2'].parentNodeToken).toBe('B');
  });

  it('翻页：has_more 的子节点列表会被继续翻到取全', async () => {
    const nodes = await service().listAllNodes('https://trip.larkenterprise.com/wiki/V8k');
    // C 只在第二页，能取到说明翻页生效
    expect(nodes.some((n) => n.nodeToken === 'C')).toBe(true);
  });

  it('isDocNode 只认文档类型（docx/doc），sheet 等返回 false', () => {
    expect(FeishuWikiService.isDocNode('docx')).toBe(true);
    expect(FeishuWikiService.isDocNode('doc')).toBe(true);
    expect(FeishuWikiService.isDocNode('sheet')).toBe(false);
    expect(FeishuWikiService.isDocNode('bitable')).toBe(false);
  });
});

describe('FeishuDocService.getContentByToken 限流重试', () => {
  beforeEach(() => {
    // 用假定时器跳过退避等待，让测试瞬时完成
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('命中 99991400 限流后退避重试，最终拿到正文', async () => {
    let calls = 0;
    const fetchSpy = vi.fn(async () => {
      calls += 1;
      // 前两次返回限流（HTTP 400 + code 99991400），第三次成功
      if (calls <= 2) {
        return {
          ok: false,
          status: 400,
          statusText: 'Bad Request',
          text: async () =>
            JSON.stringify({ code: 99_991_400, msg: 'request trigger frequency limit' }),
        } as any;
      }
      return {
        json: async () => ({ code: 0, data: { content: '# hello' } }),
        ok: true,
        status: 200,
        statusText: 'OK',
      } as any;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const promise = new FeishuDocService({ userAccessToken: 't' }).getContentByToken('docX');
    await vi.runAllTimersAsync();
    const res = await promise;

    expect(res.content).toBe('# hello');
    expect(calls).toBe(3); // 2 次限流 + 1 次成功
  });

  it('限流持续超过最大重试次数时抛错', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: async () => 'request trigger frequency limit',
    })) as any;
    vi.stubGlobal('fetch', fetchSpy);

    const promise = new FeishuDocService({ userAccessToken: 't' }).getContentByToken('docX');
    const assertion = expect(promise).rejects.toThrow(/Feishu API error/);
    await vi.runAllTimersAsync();
    await assertion;
    // 1 次初始 + 4 次重试 = 5 次
    expect(fetchSpy).toHaveBeenCalledTimes(5);
  });
});
