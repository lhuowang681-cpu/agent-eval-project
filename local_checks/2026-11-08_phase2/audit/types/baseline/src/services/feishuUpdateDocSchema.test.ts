import { FeishuMcpManifest, FeishuMcpToolName } from '@lobechat/builtin-mcp-feishu';
import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

/**
 * update-doc tool schema contract.
 *
 * The write-mode requirement (overwrite/append/... need `doc_id` + `markdown`) is steered through
 * the field DESCRIPTIONS, NOT through a JSON-Schema `allOf`/`if`/`then` conditional: Bedrock-hosted
 * Anthropic (the tripflow/Peta gateway serving Claude) rejects those keywords in tool `input_schema`
 * with a ValidationException, which broke ALL Claude tool-calling for this MCP. So the schema must
 * stay a flat object whose only hard requirement is `mode`. The empty-markdown case is handled at
 * runtime by ToolArgumentsRepairer + the repeated-failure breaker.
 *
 * This test guards against anyone reintroducing the Bedrock-breaking conditional.
 */
const updateDoc = FeishuMcpManifest.api.find((a) => a.name === FeishuMcpToolName.UpdateDoc)!;
const params = updateDoc.parameters as Record<string, unknown>;

describe('feishu update-doc schema (Bedrock-compatible, flat)', () => {
  it('does NOT use allOf/anyOf/oneOf/if/then/else (rejected by Bedrock Anthropic)', () => {
    const serialized = JSON.stringify(params);
    for (const keyword of ['allOf', 'anyOf', 'oneOf', '"if"', '"then"', '"else"']) {
      expect(serialized.includes(keyword)).toBe(false);
    }
  });

  it('requires only `mode` at the schema level', () => {
    expect(params.required).toEqual(['mode']);
  });

  it('compiles and accepts both write-mode and delete_range calls (no hard markdown gate)', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(params);
    expect(validate({ doc_id: 'D', markdown: '# Section', mode: 'append' })).toBe(true);
    // write mode without markdown is allowed by the schema; runtime layers handle it
    expect(validate({ doc_id: 'D', mode: 'append' })).toBe(true);
    expect(validate({ doc_id: 'D', mode: 'delete_range', selection_with_ellipsis: 'a...b' })).toBe(
      true,
    );
  });
});
