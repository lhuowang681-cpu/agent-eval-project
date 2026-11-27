/** Builtin provider ids excluded from the /settings/provider listing and detail route. */
const SETTINGS_PROVIDER_UI_HIDDEN_IDS = new Set<string>(['openai']);

export const isAiProviderHiddenInSettingsProviderUi = (id: string) =>
  SETTINGS_PROVIDER_UI_HIDDEN_IDS.has(id);

export function filterAiProvidersForSettingsProviderUi<T extends { id: string }>(
  list: T[],
): T[] {
  return list.filter((item) => !isAiProviderHiddenInSettingsProviderUi(item.id));
}
