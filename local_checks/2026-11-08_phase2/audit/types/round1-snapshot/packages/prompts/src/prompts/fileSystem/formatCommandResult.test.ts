import { describe, expect, it } from 'vitest';

import { formatCommandResult } from './formatCommandResult';

describe('formatCommandResult', () => {
  it('should format successful command without output', () => {
    const result = formatCommandResult({ success: true });
    expect(result).toBe('Command completed successfully.');
  });

  it('should format successful background command', () => {
    const result = formatCommandResult({ shellId: 'shell-123', success: true });
    expect(result).toBe('Command started in background with shell_id: shell-123');
  });

  it('should format successful command with stdout', () => {
    const result = formatCommandResult({ stdout: 'Hello World', success: true });
    expect(result).toBe('Command completed successfully.\n\nOutput:\nHello World');
  });

  it('should not claim outright success when exit 0 but stderr is non-empty', () => {
    const result = formatCommandResult({ stderr: 'Warning: deprecated', success: true });
    expect(result).toBe(
      'Command exited with code 0, but also wrote to stderr — review the Stderr below and verify it actually did what you intended before continuing.\n\nStderr:\nWarning: deprecated',
    );
  });

  it('should report plain success on an explicit zero exit code', () => {
    const result = formatCommandResult({ exitCode: 0, success: true });
    expect(result).toBe('Command completed successfully.');
  });

  it('should treat a non-zero exit code as failure even when envelope success is true', () => {
    // The envelope `success` only means the service responded. A SIGKILL (137),
    // SIGINT (130) or any non-zero exit must never render as "completed
    // successfully." — this is the core regression this case guards.
    const result = formatCommandResult({ exitCode: 137, success: true });
    expect(result).toBe('Command failed with exit code 137');
  });

  it('should keep stdout while reporting a non-zero exit under envelope success', () => {
    const result = formatCommandResult({ exitCode: 2, stdout: 'partial', success: true });
    expect(result).toBe('Command failed with exit code 2\n\nOutput:\npartial');
  });

  it('should format failed command with a spawn-level error', () => {
    const result = formatCommandResult({ error: 'Permission denied', success: false });
    expect(result).toBe('Command failed: Permission denied');
  });

  it('should not emit "undefined" when failed without an error message', () => {
    // A non-zero exit with no spawn-level error leaves `error` unset. The exit
    // code is folded into the header; the output must not contain "undefined".
    const result = formatCommandResult({ exitCode: 1, success: false });
    expect(result).not.toContain('undefined');
    expect(result).toBe('Command failed with exit code 1');
  });

  it('should format command with all fields', () => {
    const result = formatCommandResult({
      error: 'Command error',
      exitCode: 1,
      stderr: 'Error occurred',
      stdout: 'Some output',
      success: false,
    });
    expect(result).toBe(
      'Command failed with exit code 1: Command error\n\nOutput:\nSome output\n\nStderr:\nError occurred',
    );
  });
});
