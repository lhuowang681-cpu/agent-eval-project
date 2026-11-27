import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  AttributionError,
  digest,
  MAX_TRACE_BYTES,
  trajectorySchema,
  validateDiagnostic,
} from './contracts';
import type { Diagnostic, Trajectory } from './contracts';

const scriptDirectory = () => resolve(process.cwd(), 'scripts/eval-attribution');
/** Code fingerprint makes results from different rule/reviewer versions different jobs. */
export async function getEngineRevision() {
  const directory = scriptDirectory();
  const files = (await readdir(directory))
    .filter((name) => name.endsWith('.py') && !name.startsWith('test_'))
    .sort();
  const sources = await Promise.all(
    files.map(async (name) => [name, await readFile(resolve(directory, name), 'utf8')]),
  );
  return digest(sources);
}

export interface PythonOptions {
  executable?: string;
  timeoutMs?: number;
}

/** Local fixed program + bounded JSON pipes. No shell, credentials, dotenv, arbitrary path or network service. */
export async function runPython(
  input: Trajectory,
  options: PythonOptions = {},
): Promise<Diagnostic> {
  trajectorySchema.parse(input);
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > MAX_TRACE_BYTES)
    throw new AttributionError('trace_too_large', 'Input exceeds the subprocess contract limit');
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000)
    throw new AttributionError(
      'invalid_timeout',
      'Python deadline must be an integer between 100 and 30000 ms',
    );
  const directory = scriptDirectory();
  const environment: Record<string, string | undefined> = {
    PYTHONIOENCODING: 'utf-8',
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
  for (const name of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATHEXT']) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  const executable = options.executable ?? process.env.EVAL_ATTRIBUTION_PYTHON ?? 'python';
  return new Promise<Diagnostic>((resolveResult, reject) => {
    let settled = false;
    let outputBytes = 0;
    let stderrBytes = 0;
    const output: Buffer[] = [];
    const child = spawn(executable, ['-E', '-s', '-X', 'utf8', resolve(directory, 'adapter.py')], {
      // The app globally augments ProcessEnv with required browser-only flags. A child
      // process deliberately receives a smaller, credential-free environment instead.
      cwd: directory,
      env: environment as NodeJS.ProcessEnv,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const fail = (code: string, message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new AttributionError(code, message));
    };
    const timer = setTimeout(
      () => fail('python_timeout', 'Python attribution exceeded its bounded execution deadline'),
      timeoutMs,
    );
    child.on('error', () =>
      fail(
        'python_spawn',
        'Python executable could not be started; configure EVAL_ATTRIBUTION_PYTHON',
      ),
    );
    child.stdin.on('error', () => fail('python_stdin', 'Python attribution input pipe failed'));
    child.stdout.on('data', (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_TRACE_BYTES)
        fail('python_output_limit', 'Python attribution output exceeded 1 MiB');
      else output.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 32 * 1024)
        fail('python_stderr_limit', 'Python attribution diagnostic output exceeded its limit');
    });
    child.on('close', (code) => {
      if (settled) return;
      clearTimeout(timer);
      if (code !== 0) {
        fail('python_exit', `Python attribution exited unsuccessfully (code=${code ?? 'signal'})`);
        return;
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(output).toString('utf8'));
        const diagnostic = validateDiagnostic(parsed, input);
        if (diagnostic.jobExecution.status !== 'completed')
          throw new AttributionError(
            'python_analyzer',
            'Python analyzer reported an execution error',
          );
        settled = true;
        resolveResult(diagnostic);
      } catch (error) {
        fail(
          error instanceof AttributionError ? error.code : 'python_contract',
          'Python output failed JSON, schema, identity or evidence validation',
        );
      }
    });
    child.stdin.end(serialized, 'utf8');
  });
}
