import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as childProcess from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_TRACE_BYTES } from '../contracts';
import { getEngineRevision, runPython } from '../python';
import { diagnosticFixture, trajectoryFixture } from './fixtures';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

const python = process.env.EVAL_ATTRIBUTION_PYTHON ?? 'C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';

afterEach(() => { vi.mocked(childProcess.spawn).mockClear(); });

function fakeProcess(emit: (child: EventEmitter & { stdout: PassThrough; stderr: PassThrough }) => void) {
  const child = Object.assign(new EventEmitter(), { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough(), kill: vi.fn(() => true) });
  vi.mocked(childProcess.spawn).mockImplementationOnce((() => { queueMicrotask(() => emit(child)); return child; }) as unknown as typeof childProcess.spawn);
  return child;
}

describe('real fixed Python adapter subprocess', () => {
  it('sends one real stdin JSON and parses a real diagnostic without changing input or score', async () => {
    const input = trajectoryFixture();
    const before = structuredClone(input);
    const output = await runPython(input, { executable: python });
    expect(output.jobExecution.status).toBe('completed');
    expect(output.diagnosis.status).toBe('needs_review');
    expect(output.diagnosis.moduleId).toBeNull();
    expect(output.observations[0].category).toBe('external_transport');
    expect(output.observations[0].evidenceRefs[0].quote).toContain('service unavailable');
    expect(input).toEqual(before);
    expect(output.review).toEqual({
      existence: { status: 'valid', issues: [] },
      support: { status: 'supported', issues: [] },
    });
  }, 20000);

  it('validates Python canonical evidence from a real Unicode nested object error', async () => {
    const input = trajectoryFixture();
    input.nodes[2].content = '';
    input.nodes[2].error = { message: 'service unavailable：订单错误 😀', a: { retry: false, code: 500 }, array: ['中文', null, true] };
    const output = await runPython(input, { executable: python });
    expect(output.observations[0].evidenceRefs[0]).toEqual({ nodeId: input.nodes[2].id, field: 'error', quote: '{"a": {"code": 500, "retry": false}, "array": ["中文", null, true], "message": "service unavailable：订单错误 😀"}' });
  }, 20000);

  it('keeps unknown tool provenance and failed scoring separate from root cause', async () => {
    const input = trajectoryFixture();
    input.nodes[2].toolSource = 'unknown';
    const output = await runPython(input, { executable: python });
    expect(output.diagnosis.status).toBe('unknown');
    expect(output.diagnosis.category).toBeNull();
    expect(output.observations).toEqual([]);
    expect(input.evaluation.status).toBe('failed');
  }, 20000);

  it.each([
    { message: 'service unavailable', retryDelay: 0.000001, ratio: 1e-7 },
    { message: 'service unavailable', '\uE000': 'private-use key', '😀': 'astral key' },
  ])('accepts real Python evidence for valid JSON edge values: %j', async (error: Record<string, unknown>) => {
    const input = trajectoryFixture();
    input.nodes[2].content = '';
    input.nodes[2].error = error;
    const output = await runPython(input, { executable: python });
    expect(output.jobExecution.status).toBe('completed');
    expect(output.observations[0].category).toBe('external_transport');
    expect(output.observations[0].evidenceRefs[0].field).toBe('error');
  }, 20000);

  it.each([1e-4, 1e-5, 1e20, 1e21, -1e-5, -1e-7, 1.2e-4, 1.23e22])('aligns actual Python evidence at numeric formatting boundary %s', async (value: number) => {
    const input = trajectoryFixture();
    input.nodes[2].content = '';
    input.nodes[2].error = { message: 'service unavailable', value };
    const output = await runPython(input, { executable: python });
    expect(output.jobExecution.status).toBe('completed');
    expect(output.observations[0].evidenceRefs[0].field).toBe('error');
    expect(output.observations[0].evidenceRefs[0].quote).toContain('service unavailable');
  }, 20000);

  it('reports an invalid executable safely and never mutates the source fixture', async () => {
    const input = trajectoryFixture();
    const before = structuredClone(input);
    await expect(runPython(input, { executable: 'round1-attribution-python-that-does-not-exist' })).rejects.toMatchObject({ code: expect.stringMatching(/^python_(spawn|stdin)$/) });
    expect(input).toEqual(before);
  });

  it('fingerprints the fixed engine sources reproducibly', async () => {
    const first = await getEngineRevision();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(await getEngineRevision()).toBe(first);
  });
});

describe('bounded process failure handling (mocked process boundary only)', () => {
  it.each([99, 30001, Number.NaN])('rejects invalid timeout %s before spawn', async (timeoutMs: number) => {
    await expect(runPython(trajectoryFixture(), { timeoutMs })).rejects.toMatchObject({ code: 'invalid_timeout' });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('rejects oversized input before spawning a process', async () => {
    const input = trajectoryFixture();
    input.nodes[0].content = 'x'.repeat(MAX_TRACE_BYTES);
    await expect(runPython(input)).rejects.toMatchObject({ code: 'trace_too_large' });
    expect(childProcess.spawn).not.toHaveBeenCalled();
  });

  it('kills a process that misses the fixed deadline', async () => {
    const child = fakeProcess(() => {});
    await expect(runPython(trajectoryFixture(), { timeoutMs: 100 })).rejects.toMatchObject({ code: 'python_timeout' });
    expect(child.kill).toHaveBeenCalled();
  });

  it('rejects nonzero exit and oversized output independently of diagnosis', async () => {
    fakeProcess(child => child.emit('close', 9));
    await expect(runPython(trajectoryFixture())).rejects.toMatchObject({ code: 'python_exit' });
    const child = fakeProcess(process => process.stdout.emit('data', Buffer.alloc(MAX_TRACE_BYTES + 1)));
    await expect(runPython(trajectoryFixture())).rejects.toMatchObject({ code: 'python_output_limit' });
    expect(child.kill).toHaveBeenCalled();
  });

  it('limits stderr but accepts a small interpreter warning without exposing it', async () => {
    fakeProcess(child => child.stderr.emit('data', Buffer.alloc(32 * 1024 + 1)));
    await expect(runPython(trajectoryFixture())).rejects.toMatchObject({ code: 'python_stderr_limit' });
    const input = trajectoryFixture();
    fakeProcess(child => { child.stderr.emit('data', Buffer.from('Interpreter warning')); child.stdout.emit('data', Buffer.from(JSON.stringify(diagnosticFixture(input)))); child.emit('close', 0); });
    expect((await runPython(input)).jobExecution.status).toBe('completed');
  });

  it('rejects extra stdout logging instead of extracting a convenient JSON substring', async () => {
    const input = trajectoryFixture();
    fakeProcess(child => { child.stdout.emit('data', Buffer.from('debug log\n' + JSON.stringify(diagnosticFixture(input)))); child.emit('close', 0); });
    await expect(runPython(input)).rejects.toMatchObject({ code: 'python_contract' });
  });

  it.each(['identity', 'evidence', 'schema', 'analyzer'] as const)('rejects %s failure from a process returning exit zero', async (kind: 'identity' | 'evidence' | 'schema' | 'analyzer') => {
    const input = trajectoryFixture();
    const output = structuredClone(diagnosticFixture(input));
    if (kind === 'identity') output.inputDigest = 'wrong';
    if (kind === 'evidence') output.diagnosis.evidenceRefs = [{ nodeId: 'missing', field: 'content', quote: 'real-looking text' }];
    if (kind === 'schema') Object.assign(output.diagnosis, { category: 'invented' });
    if (kind === 'analyzer') output.jobExecution.status = 'failed';
    fakeProcess(child => { child.stdout.emit('data', Buffer.from(JSON.stringify(output))); child.emit('close', 0); });
    await expect(runPython(input)).rejects.toMatchObject({ code: { identity: 'identity_mismatch', evidence: 'invalid_evidence', schema: 'python_contract', analyzer: 'python_analyzer' }[kind] });
  });
});
