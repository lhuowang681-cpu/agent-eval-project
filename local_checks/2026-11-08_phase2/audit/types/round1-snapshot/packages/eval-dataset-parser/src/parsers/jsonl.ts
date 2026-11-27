import type { ParseOptions, ParseResult } from '../types';

export function parseJSONL(content: string, options?: ParseOptions): ParseResult {
  const lines = content
    .split('\n')
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter(({ line }) => Boolean(line));

  const totalCount = lines.length;
  const linesToParse = options?.preview ? lines.slice(0, options.preview) : lines;

  const rows = linesToParse.map(({ line, lineNumber }) => {
    try {
      return JSON.parse(line);
    } catch {
      throw new Error(`Invalid JSON at line ${lineNumber}: ${line.slice(0, 100)}`);
    }
  });

  const headers = Object.keys(rows[0] || {});

  return {
    format: 'jsonl',
    headers,
    rows,
    totalCount,
  };
}
