import { type BaiduSearchResponse } from '../index';

/**
 * 百度搜索 MCP 真实响应格式
 * https://github.com/baidu/mcp/blob/main/baidu_search/README.md
 */
export const baiduSearchMockResponse: BaiduSearchResponse = {
  results: [
    {
      title: '广州今日黄金价格多少钱一克(2026年6月8日)',
      url: 'http://3g.cnfol.com/gold/jinshijiage/20260608/32272771.shtml',
      content:
        '广州今日黄金价格多少钱一克(2026年6月8日) 2026年6月8日广州黄金价格查询_2026年6月8日广州今日金价多少钱一克?以下是广州部分金店黄金首饰报价: 2026年6月8日广州金店黄金价格​',
      source: '中金在线',
      date: '2026-06-08 15:10:05',
      icon: '',
      type: 'web',
      web_anchor: '',
      id: 1,
    },
    {
      title: '武汉今日黄金价格多少钱一克(2026年6月8日)',
      url: 'http://3g.cnfol.com/gold/jinshijiage/20260608/32272755.shtml',
      content:
        '武汉今日黄金价格多少钱一克(2026年6月8日) 2026年6月8日武汉黄金价格查询_2026年6月8日武汉今日金价多少钱一克?以下是武汉部分金店黄金首饰报价: 2026年6月8日武汉金店黄金价格​',
      source: '中金在线',
      date: '2026-06-08 12:56:04',
      icon: '',
      type: 'web',
      web_anchor: '',
      id: 2,
    },
    {
      title: '杭州今日黄金价格多少钱一克(2026年6月8日)',
      url: 'http://3g.cnfol.com/gold/jinshijiage/20260608/32272750.shtml',
      content:
        '杭州今日黄金价格多少钱一克(2026年6月8日) 2026年6月8日杭州黄金价格查询_2026年6月8日杭州今日金价多少钱一克?以下是杭州部分金店黄金首饰报价: 2026年6月8日杭州金店黄金价格​',
      source: '中金在线',
      date: '2026-06-08 12:55:52',
      icon: '',
      type: 'web',
      web_anchor: '',
      id: 3,
    },
  ],
  total_count: 3,
};

/**
 * 百度搜索 MCP 返回的原始 JSON 格式
 */
export const baiduSearchRawResponse = {
  query: '今日黄金价格 2026年6月8日',
  total_results: 15,
  items: [
    {
      title: '广州今日黄金价格多少钱一克(2026年6月8日)',
      content:
        '广州今日黄金价格多少钱一克(2026年6月8日) 2026年6月8日广州黄金价格查询_2026年6月8日广州今日金价多少钱一克?以下是广州部分金店黄金首饰报价: 2026年6月8日广州金店黄金价格​',
      source: '中金在线',
      url: 'http://3g.cnfol.com/gold/jinshijiage/20260608/32272771.shtml',
      date: '2026-06-08 15:10:05',
      icon: '',
      type: 'web',
      web_anchor: '',
      id: 1,
    },
    {
      title: '武汉今日黄金价格多少钱一克(2026年6月8日)',
      content:
        '武汉今日黄金价格多少钱一克(2026年6月8日) 2026年6月8日武汉黄金价格查询_2026年6月8日武汉今日金价多少钱一克?以下是武汉部分金店黄金首饰报价: 2026年6月8日武汉金店黄金价格​',
      source: '中金在线',
      url: 'http://3g.cnfol.com/gold/jinshijiage/20260608/32272755.shtml',
      date: '2026-06-08 12:56:04',
      icon: '',
      type: 'web',
      web_anchor: '',
      id: 2,
    },
    {
      title: '杭州今日黄金价格多少钱一克(2026年6月8日)',
      content:
        '杭州今日黄金价格多少钱一克(2026年6月8日) 2026年6月8日杭州黄金价格查询_2026年6月8日杭州今日金价多少钱一克?以下是杭州部分金店黄金首饰报价: 2026年6月8日杭州金店黄金价格​',
      source: '中金在线',
      url: 'http://3g.cnfol.com/gold/jinshijiage/20260608/32272750.shtml',
      date: '2026-06-08 12:55:52',
      icon: '',
      type: 'web',
      web_anchor: '',
      id: 3,
    },
  ],
  status: 'success',
};