/**
 * 飞书 / Lark 内网域名匹配（CreateForm、web-browsing 拦截、skill 路由共用）
 */
export const FEISHU_URL_PATTERN =
  /^https?:\/\/[^/]*(?:feishu\.cn|larksuite\.com|larkenterprise\.com)\//i;

/**
 * 飞书 URL 路由提示：当用户输入包含飞书链接时，注入到 system prompt / message 预处理中，
 * 强制 agent 使用 lark-cli (execScript) 处理，禁用 web-browsing。
 */
export const FEISHU_URL_ROUTING_HINT =
  '⚠️ The user message contains a Feishu/Lark internal URL (feishu.cn / larkenterprise.com / larksuite.com). ' +
  'These are internal pages a generic web fetch CANNOT reach. ' +
  'You MUST use the `lobe-feishu-cli` skill (via `execScript`) to read or operate this URL — ' +
  'NEVER use web-browsing / web-crawler for it. ' +
  'If the skill is not available, tell the user to enable the "Feishu CLI" skill in Settings.';
