import { createHash } from 'node:crypto';
import { z } from 'zod';

export const MAX_TRACE_BYTES = 1024 * 1024;
export const ATTRIBUTION_TASK_TYPE = 'agent-eval-attribution-v1';
const moduleIdSchema = z.enum([
  'L1.1',
  'L1.2',
  'L1.3',
  'L2.1',
  'L2.2',
  'L2.3',
  'L2.4',
  'L2.5',
  'L3.1',
  'L3.2',
  'L3.3',
  'L3.4',
  'L3.5',
  'L4.1',
  'L4.2',
  'L4.3',
  'L4.4',
  'L4.5',
  'L4.6',
  'L4.7',
  'L5.1',
  'L5.2',
  'L5.3',
  'L5.4',
  'L5.5',
  'L5.6',
  'L5.7',
  'L5.8',
  'L5.9',
  'L6.1',
  'L6.2',
  'L6.3',
  'L6.4',
  'L6.5',
  'L6.6',
  'L6.7',
  'L6.8',
  'L7.1',
  'L7.2',
  'L7.3',
  'L7.4',
  'L7.5',
  'L7.6',
  'L7.7',
  'L7.8',
  'L7.9',
  'L7.10',
  'L8.1',
  'L8.2',
  'L8.3',
  'L8.4',
  'L8.5',
  'L8.6',
  'L8.7',
  'L8.8',
  'L8.9',
]);
export const failureCategorySchema = z.enum([
  'context_window_exceeded',
  'provider_payload_invalid',
  'thinking_type_invalid',
  'model_missing',
  'builtin_tool_contract_invalid',
  'builtin_tool_unavailable',
  'builtin_result_parse_failed',
  'builtin_tool_failure_unclassified',
  'external_permission',
  'external_credential',
  'external_quota',
  'external_timeout',
  'external_transport',
  'external_tool_failure',
]);
const nonempty = z.string().min(1);
export const scopeSchema = z
  .object({
    runId: nonempty,
    caseId: nonempty,
    topicId: nonempty,
    threadId: nonempty.nullable(),
    operationId: nonempty.nullable(),
    traceIds: z.array(nonempty),
  })
  .strict();
export const nodeSchema = z
  .object({
    id: nonempty,
    messageId: nonempty.nullable(),
    parentId: nonempty.nullable(),
    role: z.enum(['system', 'user', 'assistant', 'tool', 'call', 'error']),
    content: z.string(),
    sourcePointer: nonempty,
    errorSourcePointer: nonempty.nullable().optional(),
    toolCallId: nonempty.nullable(),
    toolSource: z.enum(['builtin', 'mcp', 'plugin', 'unknown']),
    toolName: z.string().nullable(),
    arguments: z.string().nullable(),
    error: z.unknown().nullable(),
    traceId: nonempty.nullable(),
    sequence: z.number().int().nonnegative(),
    createdAt: z.string().nullable(),
  })
  .strict();
const coverageSchema = z
  .object({
    source: z.literal('database_messages'),
    complete: z.boolean(),
    warnings: z.array(z.string()),
  })
  .strict();
export const trajectorySchema = z
  .object({
    schemaVersion: z.literal(1),
    trajectoryId: nonempty,
    inputDigest: nonempty,
    scope: scopeSchema,
    nodes: z.array(nodeSchema).max(500),
    coverage: coverageSchema,
    evaluation: z
      .object({
        status: z.string(),
        score: z.number().finite().min(0).max(1).nullable(),
        task: z.string(),
        expected: z.string().nullable(),
        actual: z.string().nullable(),
        criteria: z.string().nullable(),
      })
      .strict(),
  })
  .strict();
const referenceSchema = z
  .object({
    nodeId: nonempty,
    field: z.enum(['content', 'error', 'arguments']),
    quote: nonempty,
  })
  .strict();
const issueSchema = z
  .object({ code: nonempty, nodeId: z.string().nullable(), message: z.string() })
  .strict();
export const diagnosticSchema = z
  .object({
    schemaVersion: z.literal(1),
    trajectoryId: nonempty,
    inputDigest: nonempty,
    scope: scopeSchema,
    jobExecution: z
      .object({
        status: z.enum(['completed', 'failed']),
        errors: z.array(z.object({ code: nonempty, message: z.string() }).strict()),
      })
      .strict(),
    diagnosis: z
      .object({
        status: z.enum(['resolved', 'unknown', 'needs_review', 'error']),
        category: failureCategorySchema.nullable(),
        moduleId: moduleIdSchema.nullable(),
        claimLevel: z.enum(['observation', 'root_cause']),
        summary: z.string(),
        evidenceRefs: z.array(referenceSchema),
        reasonCodes: z.array(nonempty),
      })
      .strict(),
    observations: z.array(
      z
        .object({
          category: failureCategorySchema,
          moduleId: moduleIdSchema.nullable(),
          claimLevel: z.literal('observation'),
          summary: z.string(),
          evidenceRefs: z.array(referenceSchema),
        })
        .strict(),
    ),
    coverage: coverageSchema,
    provenance: z
      .object({ rulesVersion: nonempty, sourceSha256: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict(),
    review: z
      .object({
        existence: z
          .object({
            status: z.enum(['valid', 'invalid', 'not_applicable']),
            issues: z.array(issueSchema),
          })
          .strict(),
        support: z
          .object({
            status: z.enum(['supported', 'insufficient', 'contradicted', 'not_applicable']),
            issues: z.array(issueSchema),
          })
          .strict(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type Trajectory = z.infer<typeof trajectorySchema>;
export type TraceNode = z.infer<typeof nodeSchema>;
export type Diagnostic = z.infer<typeof diagnosticSchema>;

export class AttributionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Stable compact JSON is used for identity, never an LLM-supplied identifier. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}
/** Matches Python json.dumps(sort_keys=True, ensure_ascii=False) for evidence quotes. */
function compareUnicodeKeys(left: string, right: string) {
  const a = Array.from(left, (character) => character.codePointAt(0)!);
  const b = Array.from(right, (character) => character.codePointAt(0)!);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return a.length - b.length;
}
function pythonWireNumber(value: number) {
  // Python reads JSON integer tokens as int; preserve their full wire digits.
  const wire = JSON.stringify(value);
  if (!wire.includes('.') && !/[eE]/.test(wire)) return wire;
  let representation = wire;
  if (!/[eE]/.test(wire) && Math.abs(value) < 0.0001 && value !== 0) {
    const sign = wire.startsWith('-') ? '-' : '';
    const decimals = wire.replace(/^-?0\./, '');
    const first = decimals.search(/[1-9]/);
    const significant = decimals.slice(first);
    representation = `${sign}${significant[0]}${significant.length > 1 ? `.${significant.slice(1)}` : ''}e-${first + 1}`;
  }
  return representation.replace(
    /e([+-]?)(\d+)$/i,
    (_match, sign: string, exponent: string) => `e${sign || '+'}${exponent.padStart(2, '0')}`,
  );
}
export function evidenceText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return pythonWireNumber(value);
  if (Array.isArray(value))
    return `[${value.map((item) => (typeof item === 'string' ? JSON.stringify(item) : evidenceText(item))).join(', ')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort(compareUnicodeKeys)
      .map(
        (key) =>
          `${JSON.stringify(key)}: ${typeof object[key] === 'string' ? JSON.stringify(object[key]) : evidenceText(object[key])}`,
      )
      .join(', ')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}
export function validateDiagnostic(value: unknown, input: Trajectory): Diagnostic {
  const output = diagnosticSchema.parse(value);
  if (
    output.trajectoryId !== input.trajectoryId ||
    output.inputDigest !== input.inputDigest ||
    canonicalJson(output.scope) !== canonicalJson(input.scope)
  ) {
    throw new AttributionError(
      'identity_mismatch',
      'Analyzer output does not match the original trajectory identity',
    );
  }
  if (canonicalJson(output.coverage) !== canonicalJson(input.coverage)) {
    throw new AttributionError('coverage_mismatch', 'Analyzer cannot replace source coverage');
  }
  const nodes = new Map(input.nodes.map((node) => [node.id, node]));
  for (const item of [output.diagnosis, ...output.observations]) {
    if (item.moduleId !== null && !/^L[1-8]\.\d+$/.test(item.moduleId)) {
      throw new AttributionError('invalid_module', 'Invalid module identifier');
    }
    for (const reference of item.evidenceRefs) {
      const node = nodes.get(reference.nodeId);
      if (!node || !evidenceText(node[reference.field]).includes(reference.quote)) {
        throw new AttributionError(
          'invalid_evidence',
          'Analyzer returned a missing node or a quote absent from the original field',
        );
      }
    }
  }
  if (
    output.diagnosis.status === 'resolved' &&
    (output.review?.existence.status !== 'valid' || output.review.support.status !== 'supported')
  ) {
    throw new AttributionError(
      'unsupported_conclusion',
      'A resolved diagnosis requires separate valid references and supported-claim review',
    );
  }
  return output;
}
