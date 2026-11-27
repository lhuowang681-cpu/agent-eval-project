import { resolveAcceptLanguage } from 'resolve-accept-language';

import { DEFAULT_LANG } from '@/const/locale';
import { type Locales } from '@/locales/resources';
import { locales, normalizeLocale } from '@/locales/resources';

import { RouteVariants } from './server/routeVariants';

export const getAntdLocale = async (lang?: string) => {
  const normalLang: any = normalizeLocale(lang);

  const { default: locale } = await import(`antd/locale/${normalLang.replace('-', '_')}.js`);

  return locale;
};

/**
 * Parse the browser language and return the fallback language
 */
export const parseBrowserLanguage = (
  headers: Headers,
  defaultLang: Locales = DEFAULT_LANG as Locales,
): Locales => {
  /**
   * The arguments are as follows:
   *
   * 1) The HTTP accept-language header.
   * 2) The available locales (they must contain the default locale).
   * 3) The default locale.
   */
  return resolveAcceptLanguage(
    headers.get('accept-language') || '',
    [...locales],
    defaultLang,
  ) as Locales;
};

/**
 * Parse the page locale from the URL and search
 * used in cloud
 */
export const parsePageLocale = async (props: {
  params: Promise<{ variants: string }>;
  searchParams: Promise<any>;
}) => {
  const searchParams = await props.searchParams;

  const browserLocale = await RouteVariants.getLocale(props);
  return normalizeLocale(searchParams?.hl || browserLocale) as Locales;
};
