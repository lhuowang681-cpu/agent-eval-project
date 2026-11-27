import type { Command } from 'commander';
import pc from 'picocolors';

import { outputJson, printTable, timeAgo, truncate } from '../../utils/format';

export interface MarketListOptions {
  category?: string;
  json?: string | boolean;
  keyword?: string;
  page?: string;
  size?: string;
  sort?: string;
}

export interface MarketListInput<Sort extends string = string> {
  category?: string;
  keyword?: string;
  page: number;
  pageSize: number;
  sortBy?: Sort;
}

/** Attach the shared list/mine options to a subcommand */
export function withListOptions(
  cmd: Command,
  sorts: readonly string[],
  { category = true }: { category?: boolean } = {},
): Command {
  cmd.option('-q, --keyword <keyword>', 'Filter by keyword');
  if (category) cmd.option('--category <category>', 'Filter by category');
  return cmd
    .option('--page <page>', 'Page number', '1')
    .option('--size <size>', 'Page size', '20')
    .option('--sort <sort>', `Sort by: ${sorts.join(', ')}`)
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)');
}

export function parseListInput<Sort extends string>(
  options: MarketListOptions,
  sorts: readonly Sort[],
): MarketListInput<Sort> {
  if (options.sort && !sorts.includes(options.sort as Sort)) {
    throw new Error(`Invalid sort "${options.sort}". Must be one of: ${sorts.join(', ')}`);
  }

  const input: MarketListInput<Sort> = {
    page: Number(options.page) || 1,
    pageSize: Number(options.size) || 20,
  };
  if (options.keyword) input.keyword = options.keyword;
  if (options.category) input.category = options.category;
  if (options.sort) input.sortBy = options.sort as Sort;
  return input;
}

/** Render a market resource list result ({ data, total }) as a table or JSON */
export function renderMarketList(
  result: { data?: any[]; total?: number } | undefined,
  options: { json?: string | boolean },
  emptyMessage: string,
) {
  const items = result?.data ?? [];

  if (options.json !== undefined) {
    const fields = typeof options.json === 'string' ? options.json : undefined;
    outputJson(items, fields);
    return;
  }

  if (items.length === 0) {
    console.log(emptyMessage);
    return;
  }

  const rows = items.map((item: any) => [
    item.identifier || '',
    truncate(item.title || item.name || '', 30),
    item.category || '',
    String(item.installCount ?? 0),
    truncate(item.publisherName || item.publisherUsername || '', 16),
    item.updatedAt ? timeAgo(item.updatedAt) : '',
  ]);

  printTable(rows, ['IDENTIFIER', 'TITLE', 'CATEGORY', 'INSTALLS', 'PUBLISHER', 'UPDATED']);
  if (typeof result?.total === 'number') {
    console.log(pc.dim(`Total: ${result.total}`));
  }
}

/** Render a market resource detail as key fields or JSON */
export function renderMarketDetail(detail: any, options: { json?: string | boolean }) {
  if (options.json !== undefined) {
    const fields = typeof options.json === 'string' ? options.json : undefined;
    outputJson(detail, fields);
    return;
  }

  console.log(pc.bold(detail.title || detail.name || detail.identifier || 'Untitled'));

  const meta: string[] = [];
  if (detail.identifier) meta.push(detail.identifier);
  if (detail.category) meta.push(detail.category);
  if (detail.publisherName || detail.publisherUsername)
    meta.push(`by ${detail.publisherName || detail.publisherUsername}`);
  if (detail.installCount !== undefined) meta.push(`${detail.installCount} installs`);
  if (detail.status) meta.push(detail.status);
  if (detail.updatedAt) meta.push(`updated ${timeAgo(detail.updatedAt)}`);
  if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));

  if (detail.description) {
    console.log();
    console.log(detail.description);
  }
}
