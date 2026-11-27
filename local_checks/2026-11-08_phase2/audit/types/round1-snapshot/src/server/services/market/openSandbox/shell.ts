/** Shell 单引号转义 */
export function escapeShellSingleQuoted(value: string): string {
  return value.replace(/'/g, "'\\''");
}

export function shellQuote(value: string): string {
  return `'${escapeShellSingleQuoted(value)}'}`;
}

/** 构造在沙箱内输出 JSON 的 Python 一行命令 */
export function pythonJsonScript(scriptBody: string): string {
  const escaped = scriptBody.replace(/'/g, "'\\''");
  return `python3 -c '${escaped}'`;
}

export function parseJsonStdout<T>(stdout: string): T | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const lastLine = trimmed.split('\n').filter(Boolean).pop();
    if (!lastLine) return null;
    try {
      return JSON.parse(lastLine) as T;
    } catch {
      return null;
    }
  }
}
