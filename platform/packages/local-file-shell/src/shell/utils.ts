/** Maximum output length to prevent context explosion */
export const MAX_OUTPUT_LENGTH = 80_000;

/** Strip ANSI escape codes from terminal output */
// eslint-disable-next-line no-control-regex, regexp/no-obscure-range
const ANSI_REGEX = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export const stripAnsi = (str: string): string => str.replaceAll(ANSI_REGEX, '');

/** Truncate string to max length with indicator */
export const truncateOutput = (str: string, maxLength: number = MAX_OUTPUT_LENGTH): string => {
  const cleaned = stripAnsi(str);
  if (cleaned.length <= maxLength) return cleaned;
  return (
    cleaned.slice(0, maxLength) +
    '\n... [truncated, ' +
    (cleaned.length - maxLength) +
    ' more characters]'
  );
};

/** Get cross-platform shell configuration */
export const getShellConfig = (command: string) =>
  process.platform === 'win32'
    ? // On Windows, Node escapes the `command` arg with `\"`, which cmd.exe (no `\`
      // escaping) + the target program's CRT then re-parse into literal quotes,
      // leaving residual quotes in arg values (e.g. lark-cli `--node-token "https://..."`
      // → `URL is malformed: "\"https://...\""`). Pass it verbatim so cmd.exe does a
      // single layer of quote stripping, matching POSIX `/bin/sh -c` behavior.
      { args: ['/c', command], cmd: 'cmd.exe', windowsVerbatimArguments: true }
    : { args: ['-c', command], cmd: '/bin/sh', windowsVerbatimArguments: false };
