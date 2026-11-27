/**
 * Tantivy 的布尔操作符。它们**不是**标点，逐字符转义那一套覆盖不到 ——
 * 必须整词处理，否则用户随手输入的英文就会把查询语法打断。
 */
const TANTIVY_BOOLEAN_OPERATORS = new Set(['AND', 'OR', 'NOT']);

/**
 * Escape special tantivy query syntax characters and join terms with AND
 * so all words must match (instead of Tantivy's default OR behavior).
 */
export function sanitizeBm25Query(query: string): string {
  const terms = query
    .trim()
    .replaceAll('-', ' ') // treat hyphens as word separators (ICU tokenizer does the same)
    .split(/\s+/)
    .map((word) => word.replaceAll(/[+&|!(){}[\]^"~*?:\\/]/g, '\\$&'))
    // 布尔操作符必须加引号变成普通词项。
    //
    // 本函数自己用 ` AND ` 连接词项，所以用户输入里的裸 AND/OR/NOT 会和它撞在一起：
    //   "black AND white"  →  black AND AND AND white  →  could not parse query string
    // 实测 `black AND white` / `true OR false` / `NOT found` 一律 HTTP 500 ——
    // 普通英文输入即可触发，且 message / topic / session / userMemory 等
    // 十余处 `@@@` 查询共用这个函数。
    .map((word) => (TANTIVY_BOOLEAN_OPERATORS.has(word.toUpperCase()) ? `"${word}"` : word))
    .filter(Boolean);

  if (terms.length === 0) throw new Error('Query is empty after sanitization');

  return terms.join(' AND ');
}
