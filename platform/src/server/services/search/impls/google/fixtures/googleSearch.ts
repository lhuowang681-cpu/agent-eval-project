import { type GoogleSearchResponse } from '../index';

/**
 * Google 搜索 MCP 真实响应格式（假设）
 * 实际格式需要根据 Google MCP Server 的实现确定
 */
export const googleSearchMockResponse: GoogleSearchResponse = {
  results: [
    {
      title: 'Google Search - 官方主页',
      url: 'https://www.google.com/',
      snippet: 'Google 搜索是全球最大的搜索引擎...',
      hostname: 'www.google.com',
    },
    {
      title: 'Google 地图',
      url: 'https://maps.google.com/',
      snippet: 'Google 地图 - 世界地图、街道导航...',
      hostname: 'maps.google.com',
    },
    {
      title: 'Google 翻译',
      url: 'https://translate.google.com/',
      snippet: 'Google 翻译 - 在线翻译工具...',
      hostname: 'translate.google.com',
    },
  ],
  total_count: 3,
};

/**
 * Google 搜索 MCP 返回的原始 JSON 格式（假设）
 */
export const googleSearchRawResponse = {
  query: 'Google',
  total_results: 3,
  items: [
    {
      title: 'Google Search - 官方主页',
      link: 'https://www.google.com/',
      snippet: 'Google 搜索是全球最大的搜索引擎...',
    },
    {
      title: 'Google 地图',
      link: 'https://maps.google.com/',
      snippet: 'Google 地图 - 世界地图、街道导航...',
    },
    {
      title: 'Google 翻译',
      link: 'https://translate.google.com/',
      snippet: 'Google 翻译 - 在线翻译工具...',
    },
  ],
  status: 'success',
};