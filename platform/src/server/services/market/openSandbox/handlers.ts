import debug from 'debug';

import {
  type RunCommandFileInput,
  type RunCommandOptions,
  type SandboxToolClient,
  type SupportedLanguage,
} from '../sandboxToolClient';
import {
  detectSandboxInstallPythonCode,
  detectSandboxInstallShellCommand,
} from './rejectSandboxInstallCommand';
import { escapeShellSingleQuoted, parseJsonStdout, pythonJsonScript, shellQuote } from './shell';
import { type RunBuildInToolsResponse } from './types';
import { uploadToPresignedUrl } from './uploadToPresignedUrl';

const log = debug('lobe-server:open-sandbox-handlers');

interface HandlerContext {
  client: SandboxToolClient;
  params: Record<string, unknown>;
  sessionId: string;
  toolName: string;
}

function successResult(
  toolName: string,
  result: unknown,
  sessionReused: boolean,
): RunBuildInToolsResponse {
  return {
    data: {
      result,
      sessionExpiredAndRecreated: !sessionReused,
      toolName,
    },
    success: true,
  };
}

function errorResult(code: string, message: string): RunBuildInToolsResponse {
  return {
    error: { code, message },
    success: false,
  };
}

function runOpts(
  sessionId: string,
  params: Record<string, unknown>,
): Pick<
  RunCommandOptions,
  'sessionId' | 'files' | 'timeoutMs' | 'workingDirectory' | 'envs' | 'background'
> {
  const timeoutMs = (params.timeoutMs ?? params.timeout) as number | undefined;
  return {
    sessionId,
    ...(params.files?.length && { files: params.files as RunCommandFileInput[] }),
    ...(params.workingDirectory && { workingDirectory: params.workingDirectory as string }),
    ...(params.envs && { envs: params.envs as Record<string, string> }),
    ...(timeoutMs && { timeoutMs }),
    ...(params.background && { background: Boolean(params.background) }),
  };
}

function commandResultFromRun(
  toolName: string,
  run: Awaited<ReturnType<SandboxToolClient['runCommand']>>,
): RunBuildInToolsResponse {
  if (run.error) {
    return errorResult('SANDBOX_EXECUTION_ERROR', run.error);
  }

  return successResult(
    toolName,
    {
      commandId: run.commandId,
      exitCode: run.exitCode ?? 0,
      output: run.stdout,
      stderr: run.stderr,
      stdout: run.stdout,
      success: run.success,
    },
    run.sessionReused,
  );
}

async function handleRunCommand(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const command = String(ctx.params.command ?? '');
  if (!command) return errorResult('INVALID_PARAMS', 'No command provided');

  const installRejection = detectSandboxInstallShellCommand(command);
  if (installRejection.blocked) {
    log('Blocked dependency install command: %s', command);
    return errorResult(installRejection.code, installRejection.message);
  }

  const run = await ctx.client.runCommand(command, runOpts(ctx.sessionId, ctx.params));
  return commandResultFromRun(ctx.toolName, run);
}

function mapExecuteCodeLanguage(language?: string): SupportedLanguage {
  switch (language) {
    case 'javascript':
    case 'typescript':
    case 'node': {
      return 'node';
    }
    case 'shell':
    case 'bash': {
      return 'shell';
    }
    default: {
      return 'python';
    }
  }
}

async function handleExecuteCode(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const code = String(ctx.params.code ?? '');
  if (!code) return errorResult('INVALID_PARAMS', 'No code provided');

  const language = mapExecuteCodeLanguage(String(ctx.params.language ?? 'python'));

  if (language === 'python') {
    const installRejection = detectSandboxInstallPythonCode(code);
    if (installRejection.blocked) {
      log('Blocked dependency install in executeCode');
      return errorResult(installRejection.code, installRejection.message);
    }
  }

  const run = await ctx.client.executeCodeInSession(
    ctx.sessionId,
    code,
    language,
    runOpts(ctx.sessionId, ctx.params),
  );

  if (run.error) return errorResult('SANDBOX_EXECUTION_ERROR', run.error);

  return successResult(
    ctx.toolName,
    {
      exitCode: run.exitCode ?? 0,
      output: run.stdout,
      stderr: run.stderr,
      stdout: run.stdout,
      success: run.success,
    },
    run.sessionReused,
  );
}

async function handleExportFile(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const path = String(ctx.params.path ?? '');
  const uploadUrl = String(ctx.params.uploadUrl ?? '');
  if (!path || !uploadUrl) return errorResult('INVALID_PARAMS', 'path and uploadUrl are required');

  try {
    const buffer = await ctx.client.readSandboxFileBytes(ctx.sessionId, path);
    const upload = await uploadToPresignedUrl(buffer, uploadUrl);

    if (!upload.success) {
      log('exportFile upload failed path=%s error=%s', path, upload.error);
    }

    return successResult(ctx.toolName, { success: upload.success, error: upload.error }, true);
  } catch (err) {
    const message = (err as Error).message;
    log('exportFile read failed path=%s error=%s', path, message);
    return successResult(ctx.toolName, { success: false, error: message }, true);
  }
}

async function handleListLocalFiles(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const directoryPath = String(ctx.params.directoryPath ?? ctx.params.path ?? '.');
  const p = escapeShellSingleQuoted(directoryPath);
  const script = pythonJsonScript(
    `import os,json;p='${p}';print(json.dumps([{'name':n,'isDirectory':os.path.isdir(os.path.join(p,n))} for n in sorted(os.listdir(p)) if not n.startswith('.')]))`,
  );
  const run = await ctx.client.runCommand(script, { sessionId: ctx.sessionId });
  const files = parseJsonStdout<Array<{ isDirectory: boolean; name: string }>>(run.stdout) ?? [];

  return successResult(ctx.toolName, { files }, run.sessionReused);
}

async function handleReadLocalFile(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const path = String(ctx.params.path ?? '');
  if (!path) return errorResult('INVALID_PARAMS', 'path is required');

  const startLine = ctx.params.startLine as number | undefined;
  const endLine = ctx.params.endLine as number | undefined;
  const { content, totalLines } = await ctx.client.readSandboxFile(
    ctx.sessionId,
    path,
    startLine,
    endLine,
  );

  return successResult(ctx.toolName, { content, totalLines }, true);
}

async function handleWriteLocalFile(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const path = String(ctx.params.path ?? '');
  const content = String(ctx.params.content ?? '');
  if (!path) return errorResult('INVALID_PARAMS', 'path is required');

  const { bytesWritten } = await ctx.client.writeSandboxFile(ctx.sessionId, path, content);
  return successResult(ctx.toolName, { bytesWritten, success: true }, true);
}

async function handleEditLocalFile(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const path = String(ctx.params.path ?? '');
  const search = String(ctx.params.search ?? ctx.params.oldString ?? '');
  const replace = String(ctx.params.replace ?? ctx.params.newString ?? '');
  const replaceAll = Boolean(ctx.params.all);
  if (!path || !search) return errorResult('INVALID_PARAMS', 'path and search are required');

  const { content } = await ctx.client.readSandboxFile(ctx.sessionId, path);
  const occurrences = content.split(search).length - 1;
  if (occurrences <= 0) {
    return successResult(ctx.toolName, { path, replacements: 0 }, true);
  }

  const updated = replaceAll
    ? content.split(search).join(replace)
    : content.replace(search, replace);
  const replacements = replaceAll ? occurrences : 1;
  await ctx.client.writeSandboxFile(ctx.sessionId, path, updated);

  return successResult(
    ctx.toolName,
    {
      path,
      replacements,
      linesAdded: updated.split('\n').length - content.split('\n').length,
      linesDeleted: content.split('\n').length - updated.split('\n').length,
    },
    true,
  );
}

async function handleGrepContent(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const pattern = String(ctx.params.pattern ?? '');
  const directory = String(ctx.params.directory ?? ctx.params.path ?? '.');
  if (!pattern) return errorResult('INVALID_PARAMS', 'pattern is required');

  const recursive = ctx.params.recursive !== false ? '-r' : '';
  const include = ctx.params.filePattern
    ? `--include='${escapeShellSingleQuoted(String(ctx.params.filePattern))}'`
    : '';
  const command = `grep ${recursive} -n ${include} ${shellQuote(pattern)} ${shellQuote(directory)} 2>/dev/null || true`;
  const run = await ctx.client.runCommand(command, { sessionId: ctx.sessionId });
  const lines = run.stdout.split('\n').filter(Boolean);
  const matches = lines.map((line) => {
    const match = line.match(/^([^:]+):(\d+):(.*)$/);
    return match
      ? { file: match[1], line: Number(match[2]), content: match[3] }
      : { file: directory, line: 0, content: line };
  });

  return successResult(ctx.toolName, { matches, totalMatches: matches.length }, run.sessionReused);
}

async function handleGlobLocalFiles(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const pattern = String(ctx.params.pattern ?? '*');
  const directory = String(ctx.params.directory ?? ctx.params.path ?? '.');
  const command = `find ${shellQuote(directory)} -path ${shellQuote(`${directory}/${pattern}`)} -type f 2>/dev/null | head -500`;
  const run = await ctx.client.runCommand(command, { sessionId: ctx.sessionId });
  const files = run.stdout.split('\n').filter(Boolean);

  return successResult(ctx.toolName, { files, totalCount: files.length }, run.sessionReused);
}

async function handleSearchLocalFiles(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const directory = String(ctx.params.directory ?? ctx.params.directoryPath ?? '.');
  const keyword = ctx.params.keyword ? String(ctx.params.keyword) : '*';
  const fileType = ctx.params.fileType ? String(ctx.params.fileType) : '';
  const nameExpr = fileType ? `*${keyword}*.${fileType}` : `*${keyword}*`;
  const command = `find ${shellQuote(directory)} -name ${shellQuote(nameExpr)} -type f 2>/dev/null | head -200`;
  const run = await ctx.client.runCommand(command, { sessionId: ctx.sessionId });
  const paths = run.stdout.split('\n').filter(Boolean);
  const results = paths.map((p) => ({ path: p }));

  return successResult(ctx.toolName, { results, totalCount: results.length }, run.sessionReused);
}

async function handleMoveLocalFiles(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const operations = (ctx.params.operations ?? []) as Array<{
    destination: string;
    source: string;
    from?: string;
    to?: string;
  }>;
  const results: Array<{ destination: string; source: string; success: boolean; error?: string }> =
    [];
  let successCount = 0;

  for (const op of operations) {
    const source = op.source ?? op.from ?? '';
    const destination = op.destination ?? op.to ?? '';
    const command = `mv ${shellQuote(source)} ${shellQuote(destination)}`;
    const run = await ctx.client.runCommand(command, { sessionId: ctx.sessionId });
    const ok = run.success;
    if (ok) successCount += 1;
    results.push({ destination, source, success: ok, error: run.error });
  }

  return successResult(ctx.toolName, { results, successCount }, true);
}

async function handleRenameLocalFile(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const oldPath = String(ctx.params.oldPath ?? '');
  const newName = String(ctx.params.newName ?? '');
  if (!oldPath || !newName)
    return errorResult('INVALID_PARAMS', 'oldPath and newName are required');

  const dir = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '.';
  const newPath = `${dir}/${newName}`;
  const run = await ctx.client.runCommand(`mv ${shellQuote(oldPath)} ${shellQuote(newPath)}`, {
    sessionId: ctx.sessionId,
  });

  return successResult(
    ctx.toolName,
    { newPath, success: run.success, error: run.error },
    run.sessionReused,
  );
}

async function handleGetCommandOutput(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const commandId = String(ctx.params.commandId ?? '');
  if (!commandId) return errorResult('INVALID_PARAMS', 'commandId is required');

  const output = await ctx.client.getBackgroundJobOutput(ctx.sessionId, commandId);
  return successResult(
    ctx.toolName,
    {
      newOutput: output.newOutput,
      running: output.running,
      error: output.error,
    },
    true,
  );
}

async function handleKillCommand(ctx: HandlerContext): Promise<RunBuildInToolsResponse> {
  const commandId = String(ctx.params.commandId ?? '');
  if (!commandId) return errorResult('INVALID_PARAMS', 'commandId is required');

  const result = await ctx.client.killBackgroundJob(ctx.sessionId, commandId);
  return successResult(ctx.toolName, result, true);
}

const HANDLERS: Record<string, (ctx: HandlerContext) => Promise<RunBuildInToolsResponse>> = {
  editLocalFile: handleEditLocalFile,
  executeCode: handleExecuteCode,
  exportFile: handleExportFile,
  getCommandOutput: handleGetCommandOutput,
  globLocalFiles: handleGlobLocalFiles,
  grepContent: handleGrepContent,
  killCommand: handleKillCommand,
  listLocalFiles: handleListLocalFiles,
  moveLocalFiles: handleMoveLocalFiles,
  readLocalFile: handleReadLocalFile,
  renameLocalFile: handleRenameLocalFile,
  runCommand: handleRunCommand,
  searchLocalFiles: handleSearchLocalFiles,
  writeLocalFile: handleWriteLocalFile,
};

export async function dispatchOpenSandboxTool(
  ctx: HandlerContext,
): Promise<RunBuildInToolsResponse> {
  const handler = HANDLERS[ctx.toolName];
  if (!handler) {
    log('Unknown toolName=%s, falling back to runCommand', ctx.toolName);
    if (ctx.params.command || ctx.params.code) {
      return handleRunCommand(ctx);
    }
    return errorResult('UNSUPPORTED_TOOL', `Unsupported toolName="${ctx.toolName}"`);
  }

  try {
    return await handler(ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log('Handler error toolName=%s: %s', ctx.toolName, message);
    return errorResult('SANDBOX_EXECUTION_ERROR', message);
  }
}
