import { Readability } from '@mozilla/readability';
import { Window } from 'happy-dom';
import type { TranslatorConfigObject } from 'node-html-markdown';
import { NodeHtmlMarkdown } from 'node-html-markdown';

/**
 * HTML → Markdown extraction for the desktop local web fetch.
 *
 * Adapted from `@lobechat/web-crawler`'s `htmlToMarkdown`. It is duplicated here
 * (rather than imported) so the desktop main process stays fully decoupled from
 * the web-crawler package, whose crawl-impl barrel pulls in server-only deps
 * (`@lobechat/utils/server` → `next/headers` + auth) that don't exist in the
 * Electron build. See `apps/desktop/src/main/controllers/WebCrawlerCtr.ts`.
 */

/** Truncate HTML to 1 MB before DOM parsing to prevent CPU spikes on large pages */
const MAX_HTML_SIZE = 1024 * 1024;

const cleanObj = <T extends object>(
  obj: T,
): {
  [K in keyof T as T[K] extends null ? never : K]: T[K];
} => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== null)) as any;

export interface HtmlToMarkdownOutput {
  author?: string;
  content: string;
  description?: string;
  dir?: string;
  lang?: string;
  length?: number;
  publishedTime?: string;
  siteName?: string;
  title?: string;
}

export const htmlToMarkdown = (rawHtml: string, { url }: { url: string }): HtmlToMarkdownOutput => {
  const html = rawHtml.length > MAX_HTML_SIZE ? rawHtml.slice(0, MAX_HTML_SIZE) : rawHtml;
  const window = new Window({ url });

  const document = window.document;
  document.body.innerHTML = html;

  // @ts-expect-error reason: Readability expects a Document type
  const parsedContent = new Readability(document).parse();

  let htmlNode = html;

  if (parsedContent?.content) {
    htmlNode = parsedContent.content;
  }

  const nodeHtmlMarkdown = new NodeHtmlMarkdown({}, {} as TranslatorConfigObject);

  const content = nodeHtmlMarkdown.translate(htmlNode);

  const result = {
    author: parsedContent?.byline,
    content,
    description: parsedContent?.excerpt,
    dir: parsedContent?.dir,
    lang: parsedContent?.lang,
    length: parsedContent?.length,
    publishedTime: parsedContent?.publishedTime,
    siteName: parsedContent?.siteName,
    title: parsedContent?.title,
  };

  return cleanObj(result) as HtmlToMarkdownOutput;
};
