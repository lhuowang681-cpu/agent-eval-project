import type { GatekeeperResult } from '../schemas';
import { GatekeeperResultSchema } from '../schemas';

const GATEKEEPER_LAYERS = ['activity', 'context', 'experience', 'identity', 'preference'] as const;

const SALVAGED_REASONING = 'Parsed from unstructured gatekeeper response';
const NO_CONVERSATION_REASONING = 'No analyzable conversation in gatekeeper context';

export const stripThinkingTags = (text: string) => {
  let cleaned = text
    .replaceAll(/<think>[\s\S]*?<\/redacted_thinking>/gi, '')
    .replaceAll(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/^[\s\S]*?<\/think>\s*/i, '');

  // MiniMax and similar models may leave an unclosed thinking block before prose output.
  cleaned = cleaned.replaceAll(/<think>[\s\S]*?(?=\n##|\n\||\n\*\*|$)/gi, '');

  return cleaned.trim();
};

const buildUniformDecision = (reasoning: string, shouldExtract: boolean): GatekeeperResult =>
  GatekeeperResultSchema.parse(
    Object.fromEntries(GATEKEEPER_LAYERS.map((layer) => [layer, { reasoning, shouldExtract }])),
  );

const tryParseJsonObject = (text: string): unknown | null => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export const tryParseGatekeeperJson = (text: string): GatekeeperResult | null => {
  const cleaned = stripThinkingTags(text);

  const fenced = cleaned.match(/```(?:json)?\n([\s\S]*?)```/i);
  if (fenced) {
    const parsed = tryParseJsonObject(fenced[1].trim());
    if (parsed) {
      const result = GatekeeperResultSchema.safeParse(parsed);
      if (result.success) return result.data;
    }
  }

  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const parsed = tryParseJsonObject(cleaned.slice(start, end + 1));
    if (parsed) {
      const result = GatekeeperResultSchema.safeParse(parsed);
      if (result.success) return result.data;
    }
  }

  return null;
};

const parseShouldExtractCell = (cell: string): boolean | null => {
  const normalized = cell.trim().toLowerCase();

  if (['true', 'yes', 'y', '✓', '✔'].includes(normalized)) return true;
  if (['false', 'no', 'n', '✗', '×', '—', '-', '–'].includes(normalized)) return false;

  if (/no\b|not\b|none\b|skip\b|omit\b|n\/a\b/i.test(normalized)) return false;
  if (/yes\b|extract\b|proceed\b/i.test(normalized)) return true;

  return null;
};

export const parseGatekeeperTableFallback = (text: string): GatekeeperResult | null => {
  const cleaned = stripThinkingTags(text);
  const result: Partial<GatekeeperResult> = {};
  let matched = 0;

  for (const layer of GATEKEEPER_LAYERS) {
    const pattern = new RegExp(`\\|\\s*\\*{0,2}${layer}\\*{0,2}[^\\n|]*\\|\\s*([^|\\n]+)\\|`, 'i');
    const match = cleaned.match(pattern);
    if (!match) continue;

    const shouldExtract = parseShouldExtractCell(match[1]);
    if (shouldExtract === null) continue;

    result[layer] = {
      reasoning: SALVAGED_REASONING,
      shouldExtract,
    };
    matched += 1;
  }

  if (matched !== GATEKEEPER_LAYERS.length) return null;

  return GatekeeperResultSchema.parse(result);
};

export const parseGatekeeperNoConversationFallback = (text: string): GatekeeperResult | null => {
  const cleaned = stripThinkingTags(text);
  const indicators = [
    /no new conversation provided/i,
    /cannot proceed with gate/i,
    /please provide the (?:new )?conversation/i,
    /no conversation (?:content )?(?:was )?provided/i,
  ];

  if (!indicators.some((pattern) => pattern.test(cleaned))) return null;

  return buildUniformDecision(NO_CONVERSATION_REASONING, false);
};

export const parseGatekeeperMarkdownFallback = (text: string): GatekeeperResult | null => {
  const cleaned = stripThinkingTags(text);
  const result: Partial<GatekeeperResult> = {};
  let matched = 0;

  for (const layer of GATEKEEPER_LAYERS) {
    const pattern = new RegExp(
      `${layer}\\s+layer[^\\n]{0,120}?shouldExtract\\s*[:=]\\s*\`?(true|false)\`?`,
      'i',
    );
    const match = cleaned.match(pattern);

    if (!match) continue;

    result[layer] = {
      reasoning: SALVAGED_REASONING,
      shouldExtract: match[1].toLowerCase() === 'true',
    };
    matched += 1;
  }

  if (matched !== GATEKEEPER_LAYERS.length) return null;

  return GatekeeperResultSchema.parse(result);
};

export const parseGatekeeperFromText = (text: string): GatekeeperResult | null =>
  tryParseGatekeeperJson(text) ??
  parseGatekeeperMarkdownFallback(text) ??
  parseGatekeeperTableFallback(text) ??
  parseGatekeeperNoConversationFallback(text);
