import type { FieldSchema } from '@/server/services/bot/platforms/types';

interface ChannelConfigFormState {
  applicationId?: string;
  credentials?: Record<string, string>;
  settings?: Record<string, unknown> | null;
}

interface ChannelFormSettings {
  [key: string]: {} | undefined;
}

/**
 * Allowlist fields used to be stored as a comma-separated string and briefly
 * as a bare `string[]`, before evolving into `[{ id, name? }]`. Migrate any
 * pre-object-list payload up to the new shape on read so the array form
 * editor can mount without crashing on a string. Still safe to write back —
 * the runtime parser (`parseIdList`) keeps accepting all three shapes.
 */
const ALLOWLIST_KEYS = new Set(['allowFrom', 'groupAllowFrom']);

const migrateAllowList = (value: unknown): Array<{ id: string; name?: string }> => {
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((id) => id.trim())
      .filter(Boolean)
      .map((id) => ({ id }));
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return { id: entry.trim() };
        if (entry && typeof entry === 'object' && 'id' in entry) {
          const id = String((entry as { id?: unknown }).id ?? '').trim();
          const rawName = (entry as { name?: unknown }).name;
          const name = typeof rawName === 'string' ? rawName : undefined;
          return name ? { id, name } : { id };
        }
        return { id: '' };
      })
      .filter((entry) => entry.id);
  }
  return [];
};

/**
 * `watchKeywords` is form-edited as `Array<{ keyword, instruction? }>`, but the
 * runtime parser (`extractWatchKeywordEntries`) also accepts a `string` (comma/
 * whitespace separated) or `string[]`. Imported/legacy configs can therefore
 * carry a non-array value; feeding that straight into `AntdForm.List` breaks the
 * Advanced Settings panel. Normalise to the object-array shape on read.
 */
const migrateWatchKeywords = (value: unknown): Array<{ instruction?: string; keyword: string }> => {
  if (typeof value === 'string') {
    return value
      .split(/[\s,]+/)
      .map((keyword) => keyword.trim())
      .filter(Boolean)
      .map((keyword) => ({ keyword }));
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (typeof entry === 'string') return { keyword: entry.trim() };
        if (entry && typeof entry === 'object' && 'keyword' in entry) {
          const keyword = String((entry as { keyword?: unknown }).keyword ?? '').trim();
          const rawInstruction = (entry as { instruction?: unknown }).instruction;
          const instruction =
            typeof rawInstruction === 'string' && rawInstruction.trim()
              ? rawInstruction
              : undefined;
          return instruction ? { instruction, keyword } : { keyword };
        }
        return { keyword: '' };
      })
      .filter((entry) => entry.keyword);
  }
  return [];
};

const normalizeSettings = (settings?: Record<string, unknown> | null): ChannelFormSettings =>
  Object.fromEntries(
    Object.entries(settings || {}).map(([key, value]) => {
      if (ALLOWLIST_KEYS.has(key)) return [key, migrateAllowList(value)];
      if (key === 'watchKeywords') return [key, migrateWatchKeywords(value)];
      return [key, value ?? undefined];
    }),
  );

export const getChannelFormValues = (config: ChannelConfigFormState) => ({
  applicationId: config.applicationId || '',
  credentials: config.credentials || {},
  settings: normalizeSettings(config.settings),
});

/**
 * Extract default values from a platform's settings schema, in the same flat
 * shape used by the form (top-level keys + flattened nested object children,
 * matching `getFields` in Body.tsx).
 *
 * Needed because antd `<FormItem initialValue>` only writes to the form store
 * after the FormItem mounts. Settings live behind a collapsible "Advanced
 * Settings" panel that defaults to collapsed — so users who never expand it
 * submit `settings: {}`, dropping every default and leaving the runtime to
 * guess at fields like `connectionMode`.
 */
export const extractSettingsDefaults = (
  schema: FieldSchema[] | undefined,
): Record<string, unknown> => {
  const settingsSection = schema?.find((f) => f.key === 'settings');
  if (!settingsSection?.properties) return {};

  const defaults: Record<string, unknown> = {};
  for (const field of settingsSection.properties) {
    if (field.type === 'object' && field.properties) {
      for (const child of field.properties) {
        if (child.default !== undefined) defaults[child.key] = child.default;
      }
      continue;
    }
    if (field.default !== undefined) defaults[field.key] = field.default;
  }
  return defaults;
};

/**
 * Merge schema defaults into the user-submitted settings object. User-provided
 * values always win over defaults.
 */
export const mergeSettingsWithDefaults = (
  schema: FieldSchema[] | undefined,
  settings: Record<string, unknown>,
): Record<string, unknown> => ({
  ...extractSettingsDefaults(schema),
  ...settings,
});
