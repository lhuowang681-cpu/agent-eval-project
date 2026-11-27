import { type BuiltinSkill } from '@lobechat/types';

import { toResourceMeta } from '../tripyoyo/helpers';
import { systemPrompt } from './content';
import adapterAuthor from './references/opencli-adapter-author.md';
import autofix from './references/opencli-autofix.md';
import browser from './references/opencli-browser.md';
import browserSitemap from './references/opencli-browser-sitemap.md';
import sitemapAuthor from './references/opencli-sitemap-author.md';
import usage from './references/opencli-usage.md';
import smartSearch from './references/smart-search.md';

export const OpenCliIdentifier = 'lobe-opencli';

export const OpenCliSkill: BuiltinSkill = {
  avatar: '🌐',
  content: systemPrompt,
  description:
    "Drive the user's own logged-in Chrome via OpenCLI (Browser Bridge) — browser automation, sitemaps, adapters, smart search. Reuses the real browser session. Desktop only; requires the Browser Bridge Chrome extension.",
  identifier: OpenCliIdentifier,
  name: '助手浏览器',
  resources: toResourceMeta({
    'references/opencli-browser': browser,
    'references/opencli-usage': usage,
    'references/opencli-browser-sitemap': browserSitemap,
    'references/opencli-sitemap-author': sitemapAuthor,
    'references/opencli-adapter-author': adapterAuthor,
    'references/opencli-autofix': autofix,
    'references/smart-search': smartSearch,
  }),
  source: 'builtin',
};
