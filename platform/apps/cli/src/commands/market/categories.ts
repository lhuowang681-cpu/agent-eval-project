// Publish-time category values, inlined from
// packages/types/src/discover/marketCategories.ts (the backend accepts any
// string, so validation lives client-side — keep in sync with that file).

export const ASSISTANT_PUBLISH_CATEGORIES = [
  'data-analytics',
  'product-manager',
  'new-media',
  'marketing',
  'coding',
  'designer',
  'user-research',
  'hr-finance',
  'other',
] as const;

export const SKILL_PUBLISH_CATEGORIES = [
  'data-analytics',
  'product-planning',
  'content-creation',
  'marketing',
  'ops-analytics',
  'design-creation',
  'research-insight',
  'report-writing',
  'deep-thinking',
  'other',
] as const;

export const MCP_PUBLISH_CATEGORIES = [
  'data-storage',
  'collaboration',
  'info-fetch',
  'coding',
  'business-system',
  'user-feedback',
  'design-assets',
  'project-management',
  'other',
] as const;

/**
 * Validate a publish category. Returns an error message listing valid values
 * when invalid, or undefined when valid.
 */
export function validateCategory(value: string, allowed: readonly string[]): string | undefined {
  if (allowed.includes(value)) return undefined;
  return `Invalid category "${value}". Must be one of: ${allowed.join(', ')}`;
}
