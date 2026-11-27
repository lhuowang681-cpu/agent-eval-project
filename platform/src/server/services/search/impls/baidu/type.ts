/**
 * 百度搜索 MCP 请求参数
 */
export interface BaiduSearchParameters {
  /** 搜索查询字符串，支持各种搜索语法和关键词组合 (必填) */
  query: string;
  /** 搜索时间过滤，可选值：week(最近7天), month(最近30天), semiyear(最近180天), year(最近365天) */
  search_recency_filter?: string;
  /** 网页搜索结果数量，范围1-20 */
  web_topk?: number;
}

/**
 * 百度搜索结果项
 */
export interface BaiduSearchResultItem {
  /** 标题 */
  title: string;
  /** URL 地址 */
  url: string;
  /** 正文内容/摘要 */
  content?: string;
  /** 来源网站 */
  source?: string;
  /** 抓取时间 */
  date?: string;
  /** 图标 */
  icon?: string;
  /** 类型 */
  type?: string;
  /** 锚文本 */
  web_anchor?: string;
  /** 结果 ID */
  id?: number;
}

/**
 * 百度搜索 MCP 响应
 */
export interface BaiduSearchResponse {
  /** 结果列表 */
  results: BaiduSearchResultItem[];
  /** 总结果数 */
  total_count?: number;
}