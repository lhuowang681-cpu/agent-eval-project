import { describe, expect, it } from 'vitest';

import {
  parseGatekeeperFromText,
  parseGatekeeperMarkdownFallback,
  parseGatekeeperNoConversationFallback,
  parseGatekeeperTableFallback,
  stripThinkingTags,
} from './parseGatekeeperText';

describe('parseGatekeeperFromText', () => {
  it('parses markdown layer decisions from unstructured gatekeeper output', () => {
    const text = `
<think>internal reasoning</think>

## Memory Extraction Analysis

**Activity Layer**: \`shouldExtract: false\`
- No episodic events

**Identity Layer**: \`shouldExtract: false\`
- No identity facts

**Context Layer**: \`shouldExtract: false\`
- One-off task

**Preference Layer**: \`shouldExtract: false\`
- Task-specific instructions

**Experience Layer**: \`shouldExtract: false\`
- Routine processing
`;

    const result = parseGatekeeperMarkdownFallback(text);

    expect(result).toEqual({
      activity: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      context: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      experience: {
        reasoning: 'Parsed from unstructured gatekeeper response',
        shouldExtract: false,
      },
      identity: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      preference: {
        reasoning: 'Parsed from unstructured gatekeeper response',
        shouldExtract: false,
      },
    });
  });

  it('strips unclosed MiniMax thinking blocks before parsing', () => {
    const text = `<think>internal reasoning without a closing tag

## Memory Extraction Analysis

**Activity Layer**: \`shouldExtract: false\`
**Identity Layer**: \`shouldExtract: false\`
**Context Layer**: \`shouldExtract: false\`
**Preference Layer**: \`shouldExtract: false\`
**Experience Layer**: \`shouldExtract: false\`
`;

    expect(stripThinkingTags(text)).toContain('## Memory Extraction Analysis');
    expect(parseGatekeeperMarkdownFallback(text)).toEqual({
      activity: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      context: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      experience: {
        reasoning: 'Parsed from unstructured gatekeeper response',
        shouldExtract: false,
      },
      identity: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      preference: {
        reasoning: 'Parsed from unstructured gatekeeper response',
        shouldExtract: false,
      },
    });
  });

  it('parses markdown table gatekeeper output', () => {
    const text = `
| **Activity** | — | No new conversation provided to evaluate |
| **Identity** | — | No new conversation provided to evaluate |
| **Context** | — | No new conversation provided to evaluate |
| **Preference** | — | No new conversation provided to evaluate |
| **Experience** | — | No new conversation provided to evaluate |
`;

    expect(parseGatekeeperTableFallback(text)).toEqual({
      activity: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      context: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      experience: {
        reasoning: 'Parsed from unstructured gatekeeper response',
        shouldExtract: false,
      },
      identity: { reasoning: 'Parsed from unstructured gatekeeper response', shouldExtract: false },
      preference: {
        reasoning: 'Parsed from unstructured gatekeeper response',
        shouldExtract: false,
      },
    });
  });

  it('falls back to all-false when the model says no conversation was provided', () => {
    const text = `
**Conclusion**: Cannot proceed with gate keeping analysis. Please provide the new conversation content.
`;

    expect(parseGatekeeperNoConversationFallback(text)).toEqual({
      activity: {
        reasoning: 'No analyzable conversation in gatekeeper context',
        shouldExtract: false,
      },
      context: {
        reasoning: 'No analyzable conversation in gatekeeper context',
        shouldExtract: false,
      },
      experience: {
        reasoning: 'No analyzable conversation in gatekeeper context',
        shouldExtract: false,
      },
      identity: {
        reasoning: 'No analyzable conversation in gatekeeper context',
        shouldExtract: false,
      },
      preference: {
        reasoning: 'No analyzable conversation in gatekeeper context',
        shouldExtract: false,
      },
    });
  });

  it('parses fenced JSON gatekeeper output', () => {
    const text = `\`\`\`json
{
  "activity": { "reasoning": "a", "shouldExtract": true },
  "context": { "reasoning": "b", "shouldExtract": false },
  "experience": { "reasoning": "c", "shouldExtract": false },
  "identity": { "reasoning": "d", "shouldExtract": true },
  "preference": { "reasoning": "e", "shouldExtract": false }
}
\`\`\``;

    expect(parseGatekeeperFromText(text)).toEqual({
      activity: { reasoning: 'a', shouldExtract: true },
      context: { reasoning: 'b', shouldExtract: false },
      experience: { reasoning: 'c', shouldExtract: false },
      identity: { reasoning: 'd', shouldExtract: true },
      preference: { reasoning: 'e', shouldExtract: false },
    });
  });
});
