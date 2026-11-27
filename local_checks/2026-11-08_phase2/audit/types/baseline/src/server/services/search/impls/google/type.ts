/**
 * Google 搜索 MCP 请求参数
 */
export interface GoogleSearchParameters {
  /** 搜索查询字符串，支持各种搜索语法和关键词组合 (必填) */
  query: string;
  /** 返回的搜索结果数量，范围1-100，默认为10 */
  num?: number;
  /** 需要排除的搜索词，用逗号分隔。例如：'广告,推广' 会自动在查询中添加排除逻辑 */
  exclude_terms?: string;
}

/**
 * Google 搜索结果项
 */
export interface GoogleSearchResultItem {
  /** 标题 */
  title: string;
  /** URL 地址 */
  url: string;
  /** 摘要内容 */
  snippet?: string;
  /** 域名 */
  hostname?: string;
  /** 抓取时间 */
  dateLastCrawled?: string;
}

/**
 * Google 搜索 MCP 响应
 */
export interface GoogleSearchResponse {
  /** 结果列表 */
  results: GoogleSearchResultItem[];
  /** 总结果数 */
  total_count?: number;
}