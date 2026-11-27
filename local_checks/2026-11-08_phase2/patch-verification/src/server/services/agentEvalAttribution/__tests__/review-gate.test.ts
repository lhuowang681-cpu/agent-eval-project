import { describe, expect, it } from 'vitest';

import { validateDiagnostic } from '../contracts';
import { diagnosticFixture, trajectoryFixture } from './fixtures';

describe('resolved diagnostic contract requires an independent evidence review', () => {
  it('rejects an unreviewed high-confidence conclusion despite an existing quoted node', () => {
    const input = trajectoryFixture();
    const output = diagnosticFixture(input);
    output.diagnosis = {...output.diagnosis, status: 'resolved', category: 'external_transport', evidenceRefs: [{nodeId: 'message:result', field: 'content', quote: 'service unavailable'}]};
    expect(() => validateDiagnostic(output, input)).toThrow('requires separate');
  });
  it('does not treat citation existence as enough support for a root-cause conclusion', () => {
    const input = trajectoryFixture();
    const output = diagnosticFixture(input);
    output.diagnosis = {...output.diagnosis, status: 'resolved', claimLevel: 'root_cause', moduleId: 'L2.2', evidenceRefs: [{nodeId: 'message:result', field: 'content', quote: 'service unavailable'}]};
    output.review = {existence: {status: 'valid', issues: []}, support: {status: 'insufficient', issues: [{code: 'root_cause_unproved', nodeId: null, message: 'External failure does not prove malformed internal parameters'}]}};
    expect(() => validateDiagnostic(output, input)).toThrow('requires separate');
  });
  it('retains compatibility for an explicit unknown diagnosis and validates reviewed observations', () => {
    const input = trajectoryFixture();
    const output = diagnosticFixture(input);
    expect(validateDiagnostic(output, input).diagnosis.status).toBe('unknown');
    output.diagnosis.status = 'resolved';
    output.diagnosis.category = 'external_transport';
    output.diagnosis.evidenceRefs = [{nodeId: 'message:result', field: 'content', quote: 'service unavailable'}];
    output.review = {existence: {status: 'valid', issues: []}, support: {status: 'supported', issues: []}};
    expect(validateDiagnostic(output, input).diagnosis.status).toBe('resolved');
  });
});
