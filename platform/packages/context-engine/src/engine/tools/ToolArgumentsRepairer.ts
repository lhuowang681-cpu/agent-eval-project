import { safeParseJSON, safeParsePartialJSON } from '@lobechat/utils';

import type { LobeToolManifest } from './types';

/**
 * JSON Schema type for tool parameters
 */
export interface ToolParameterSchema {
  properties?: Record<string, unknown>;
  required?: string[];
  type?: string;
}

/**
 * Tool Arguments Repairer
 *
 * Handles repair of malformed tool call arguments caused by LLM string escape issues.
 *
 * When some LLMs (like Claude haiku-4.5) output tool calls, they may produce malformed JSON
 * where the entire content gets stuffed into the first field with escaped quotes.
 *
 * @example Malformed data:
 * ```javascript
 * { description: 'real desc", "instruction": "real instruction", "timeout": 120}' }
 * ```
 *
 * @example Expected data:
 * ```javascript
 * { description: 'real desc', instruction: 'real instruction', timeout: 120 }
 * ```
 *
 * @example Usage:
 * ```typescript
 * const repairer = new ToolArgumentsRepairer(manifest);
 * const args = repairer.parse('execTask', argumentsString);
 * ```
 */
export class ToolArgumentsRepairer {
  private manifest?: LobeToolManifest;

  /**
   * Create a new ToolArgumentsRepairer
   * @param manifest - Tool manifest for schema lookup
   */
  constructor(manifest?: LobeToolManifest) {
    this.manifest = manifest;
  }

  /**
   * Parse and repair tool call arguments
   *
   * @param apiName - API name
   * @param argumentsStr - Raw arguments string from LLM
   * @returns Parsed and repaired arguments object
   */
  parse(apiName: string, argumentsStr: string): Record<string, unknown> {
    // Try standard JSON parse first, then fall back to partial JSON parsing
    // to recover parameters from truncated/malformed JSON (e.g., XML corruption)
    const parsed =
      safeParseJSON<Record<string, unknown>>(argumentsStr) ??
      safeParsePartialJSON(argumentsStr) ??
      {};

    // Get API schema for repair
    const apiSchema = this.manifest?.api?.find((a) => a.name === apiName)?.parameters;

    return this.repair(parsed, apiSchema);
  }

  /**
   * Repair malformed arguments using schema
   *
   * @param parsed - The parsed (but potentially malformed) arguments object
   * @param schema - The JSON schema for the tool's parameters (with required fields)
   * @returns The repaired arguments object
   */
  repair(parsed: Record<string, unknown>, schema?: ToolParameterSchema): Record<string, unknown> {
    // We need the declared field names to detect a body that got mangled into another field.
    // Candidates are all schema properties (not just `required`) so that an optional-but-present
    // field (e.g. feishu update-doc's `markdown`) can still be recovered. `required` carries a
    // separate meaning — it is serialized into the tool schema sent to the model — so coupling
    // recovery to it would force us to over-declare fields as mandatory.
    const candidateFields = schema?.properties ? Object.keys(schema.properties) : [];
    if (candidateFields.length === 0) {
      return parsed;
    }

    const keys = Object.keys(parsed);
    const missingFields = candidateFields.filter((f) => !(f in parsed));

    // If no declared field is missing, there is nothing to recover
    if (missingFields.length === 0) {
      return parsed;
    }

    // Check if any existing field's value contains the missing field patterns
    // This indicates the string escape issue
    for (const key of keys) {
      const value = parsed[key];
      if (typeof value !== 'string') continue;

      // Check if value contains patterns like `", "missingField":` or `", \"missingField\":`
      const hasMissingFieldPattern = missingFields.some(
        (field) => value.includes(`", "${field}":`) || value.includes(`", \\"${field}\\":`),
      );

      if (hasMissingFieldPattern) {
        // Try to reconstruct the correct JSON
        // The value is actually: 'realValue", "field2": "value2", ...}'
        // So we rebuild: '{"key": "realValue", "field2": "value2", ...}'
        try {
          const reconstructed = `{"${key}": "${value}`;
          const repaired = JSON.parse(reconstructed) as Record<string, unknown>;

          // Verify the repair actually split the mangled value into more fields, otherwise
          // keep the original to avoid accepting a misleading reconstruction.
          if (Object.keys(repaired).length > keys.length) {
            return repaired;
          }
        } catch {
          // Repair failed, continue to try other approaches or return original
        }
      }
    }

    // Could not repair, return original parsed data
    return parsed;
  }
}
