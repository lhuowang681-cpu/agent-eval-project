/**
 * Normalize language code
 */
export const normalizeLocale = (locale: string) => {
  return locale.toLowerCase().replace('_', '-');
};

/**
 * Load translation resources on demand
 */
export const loadResources = async (lng: string, ns: string) => {
  // All locales (including zh-CN) load from resources/locales/<locale>/<ns>.json
  // Use lng directly (don't normalize) to match glob keys (zh-CN not zh-cn)
  const folder = lng === 'en' || lng.startsWith('en-') ? 'en' : lng;

  try {
    // Use import.meta.glob to pre-load all locale files at build time
    const modules = import.meta.glob('../../../resources/locales/**/*.json');
    const key = `../../../resources/locales/${folder}/${ns}.json`;
    const mod = modules[key];
    if (mod) {
      const { default: content } = (await mod()) as any;
      return content;
    }
    throw new Error(`No module found for ${key}`);
  } catch (error) {
    console.error(`Unable to load translation file: ${lng} - ${ns}`, error);
    return {};
  }
};
