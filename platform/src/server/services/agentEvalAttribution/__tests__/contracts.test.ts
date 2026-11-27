import { describe, expect, it } from 'vitest';

import { canonicalJson, diagnosticSchema, digest, evidenceText, trajectorySchema, validateDiagnostic } from '../contracts';
import { diagnosticFixture, trajectoryFixture } from './fixtures';

describe('attribution contract validation', () => {
  it('accepts a diagnostic only for its original trajectory and retains Unicode source fields', () => {
    const input = trajectoryFixture();
    input.nodes[2].error = { message: '订单错误：外部服务不可用 😀', nested: { retry: false, values: [null, '中文', 500] } };
    const output = structuredClone(diagnosticFixture(input));
    output.diagnosis.evidenceRefs = [{ nodeId: input.nodes[2].id, field: 'error', quote: evidenceText(input.nodes[2].error) }];
    expect(validateDiagnostic(output, input)).toEqual(output);
    expect(input.evaluation.score).toBe(0);
  });

  it.each(['trajectoryId', 'inputDigest', 'runId', 'caseId', 'topicId', 'threadId', 'operationId', 'traceIds'] as const)('rejects mismatched %s', (field: 'trajectoryId' | 'inputDigest' | 'runId' | 'caseId' | 'topicId' | 'threadId' | 'operationId' | 'traceIds') => {
    const input = trajectoryFixture();
    const output = structuredClone(diagnosticFixture(input));
    if (field === 'trajectoryId' || field === 'inputDigest') output[field] += '-wrong';
    else if (field === 'traceIds') output.scope.traceIds = ['another-trace'];
    else output.scope[field as 'runId' | 'caseId' | 'topicId' | 'threadId' | 'operationId'] = 'different';
    expect(() => validateDiagnostic(output, input)).toThrow(expect.objectContaining({ code: 'identity_mismatch' }));
  });

  it('rejects replacing source coverage with an analyzer claim of completeness', () => {
    const input = trajectoryFixture();
    input.coverage.complete = false;
    const output = structuredClone(diagnosticFixture(input));
    output.coverage.complete = true;
    expect(() => validateDiagnostic(output, input)).toThrow(expect.objectContaining({ code: 'coverage_mismatch' }));
  });

  it.each(['diagnosis', 'observations'] as const)('rejects nonexistent nodes and forged quotes in %s', (part: 'diagnosis' | 'observations') => {
    const input = trajectoryFixture();
    for (const ref of [{ nodeId: 'other-case-message', field: 'content' as const, quote: 'service unavailable' }, { nodeId: input.nodes[2].id, field: 'content' as const, quote: 'Agent generated invalid arguments' }]) {
      const output = structuredClone(diagnosticFixture(input));
      if (part === 'diagnosis') output.diagnosis.evidenceRefs = [ref];
      else output.observations = [{ category: 'external_transport', moduleId: null, claimLevel: 'observation', summary: 'Observed failure', evidenceRefs: [ref] }];
      expect(() => validateDiagnostic(output, input)).toThrow(expect.objectContaining({ code: 'invalid_evidence' }));
    }
  });

  it('accepts every real module and rejects invented modules/categories and NaN scores', () => {
    const input = trajectoryFixture();
    const valid = diagnosticFixture(input);
    for (const [layer, count] of [[1,3],[2,5],[3,5],[4,7],[5,9],[6,8],[7,10],[8,9]]) {
      for (let leaf = 1; leaf <= count; leaf++) {
        expect(diagnosticSchema.safeParse({ ...valid, diagnosis: { ...valid.diagnosis, moduleId: `L${layer}.${leaf}` } }).success).toBe(true);
      }
    }
    for (const invalid of [{ moduleId: 'L7.11' }, { moduleId: 'L99.1' }, { category: 'invented_category' }, { status: 'success' }]) {
      expect(diagnosticSchema.safeParse({ ...valid, diagnosis: { ...valid.diagnosis, ...invalid } }).success).toBe(false);
    }
    expect(trajectorySchema.safeParse({ ...input, evaluation: { ...input.evaluation, score: Number.NaN } }).success).toBe(false);
  });

  it('rejects unknown contract fields and an empty evidence quote', () => {
    const input = trajectoryFixture();
    const output = diagnosticFixture(input);
    expect(trajectorySchema.safeParse({ ...input, arbitraryScriptPath: 'other.py' }).success).toBe(false);
    expect(diagnosticSchema.safeParse({ ...output, diagnosis: { ...output.diagnosis, evidenceRefs: [{ nodeId: input.nodes[2].id, field: 'content', quote: '' }] } }).success).toBe(false);
  });

  it('fingerprints equivalent object key orders identically without changing the original object', () => {
    const input = { z: ['中文', null, true], a: { y: 2, x: '😀' } };
    const before = structuredClone(input);
    expect(digest(input)).toBe(digest({ a: { x: '😀', y: 2 }, z: ['中文', null, true] }));
    expect(canonicalJson(input)).toBe('{"a":{"x":"😀","y":2},"z":["中文",null,true]}');
    expect(input).toEqual(before);
  });
});
