import { readFile } from 'node:fs/promises';

import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm } from '../../utils/format';
import { parseJsonArg } from '../../utils/json-arg';
import { log } from '../../utils/logger';
import { MCP_PUBLISH_CATEGORIES, validateCategory } from './categories';
import { parseListInput, renderMarketDetail, renderMarketList, withListOptions } from './common';

const SORTS = ['recommended', 'installCount', 'updatedAt', 'createdAt'] as const;

async function readJsonFile(path: string, label: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    log.error(`Failed to read ${label} file "${path}": ${(error as Error).message}`);
    process.exit(1);
  }
}

export function registerMarketMcpCommand(market: Command) {
  const mcp = market.command('mcp').description('Browse, install and publish market MCP plugins');

  // ── list ──────────────────────────────────────────────

  withListOptions(mcp.command('list').description('List market MCP plugins'), SORTS).action(
    async (options) => {
      const client = await getTrpcClient();
      const result = await client.market.getMcpList.query(parseListInput(options, SORTS));
      renderMarketList(result, options, 'No market MCP plugins found.');
    },
  );

  // ── view ──────────────────────────────────────────────

  mcp
    .command('view <identifier>')
    .description('View market MCP plugin details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (identifier: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.getMcpDetail.query({ identifier });

      if (!result) {
        log.error(`Market MCP plugin not found: ${identifier}`);
        process.exit(1);
        return;
      }

      renderMarketDetail(result, options);
    });

  // ── install ───────────────────────────────────────────

  mcp
    .command('install <identifier>')
    .alias('i')
    .description('Install a market MCP plugin into my account')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      const result = await client.market.mcp.installMcp.mutate({ identifier });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Installed MCP plugin ${pc.bold(identifier)}${r?.id ? ` (${r.id})` : ''}`,
      );
    });

  // ── upgrade ───────────────────────────────────────────

  mcp
    .command('upgrade <identifier>')
    .description('Update my installed copy to the latest market version')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      await client.market.mcp.updateInstalledMcp.mutate({ identifier });
      console.log(`${pc.green('✓')} Upgraded installed MCP plugin ${pc.bold(identifier)}`);
    });

  // ── publish ───────────────────────────────────────────

  mcp
    .command('publish <identifier>')
    .description('Publish a local MCP plugin to the market')
    .requiredOption('-c, --category <category>', `Category: ${MCP_PUBLISH_CATEGORIES.join(', ')}`)
    .requiredOption(
      '--manifest <json-or-file>',
      'Plugin manifest JSON, inline or a path to a JSON file',
    )
    .option('--params <file>', 'Path to a custom params JSON file')
    .option('--name <displayName>', 'Publish under a new display name')
    .action(
      async (
        identifier: string,
        options: { category: string; manifest: string; name?: string; params?: string },
      ) => {
        const categoryError = validateCategory(options.category, MCP_PUBLISH_CATEGORIES);
        if (categoryError) {
          log.error(categoryError);
          process.exit(1);
          return;
        }

        const manifest = await parseJsonArg(options.manifest, 'manifest');
        const customParams = options.params
          ? await readJsonFile(options.params, 'custom params')
          : undefined;

        const client = await getTrpcClient();

        if (options.name) {
          const conflict = await client.market.mcp.checkPublishNameConflict.query({
            displayName: options.name,
          });
          if ((conflict as any)?.conflict) {
            log.error(`Display name already taken: ${options.name}`);
            process.exit(1);
            return;
          }
        }

        const result = await client.market.mcp.publishMcp.mutate({
          category: options.category,
          customParams,
          identifier,
          manifest,
          newDisplayName: options.name,
        });
        const r = result as any;
        console.log(
          `${pc.green('✓')} Published MCP plugin ${pc.bold(r?.identifier || identifier)} to the market`,
        );
      },
    );

  // ── update (republish) ────────────────────────────────

  mcp
    .command('update <identifier>')
    .description('Republish my published MCP plugin (optionally with a new manifest)')
    .option('--manifest <json-or-file>', 'New manifest JSON, inline or a path to a JSON file')
    .option('--params <file>', 'Path to a new custom params JSON file')
    .action(async (identifier: string, options: { manifest?: string; params?: string }) => {
      const manifest = options.manifest
        ? await parseJsonArg(options.manifest, 'manifest')
        : undefined;
      const customParams = options.params
        ? await readJsonFile(options.params, 'custom params')
        : undefined;

      const client = await getTrpcClient();
      await client.market.mcp.updateMcp.mutate({ customParams, identifier, manifest });
      console.log(`${pc.green('✓')} Updated published MCP plugin ${pc.bold(identifier)}`);
    });

  // ── delist ────────────────────────────────────────────

  mcp
    .command('delist <identifier>')
    .description('Delist my published MCP plugin from the market')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (identifier: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delist this MCP plugin?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.mcp.delistMcp.mutate({ identifier });
      console.log(`${pc.green('✓')} Delisted MCP plugin ${pc.bold(identifier)}`);
    });

  // ── relist ────────────────────────────────────────────

  mcp
    .command('relist <identifier>')
    .description('Relist my delisted MCP plugin on the market')
    .option('-c, --category <category>', `New category: ${MCP_PUBLISH_CATEGORIES.join(', ')}`)
    .option('--name <displayName>', 'New display name')
    .action(async (identifier: string, options: { category?: string; name?: string }) => {
      if (options.category) {
        const categoryError = validateCategory(options.category, MCP_PUBLISH_CATEGORIES);
        if (categoryError) {
          log.error(categoryError);
          process.exit(1);
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.mcp.relistMcp.mutate({
        category: options.category,
        displayName: options.name,
        identifier,
      });
      console.log(`${pc.green('✓')} Relisted MCP plugin ${pc.bold(identifier)}`);
    });

  // ── restore ───────────────────────────────────────────

  mcp
    .command('restore <identifier>')
    .description('Restore my published MCP plugin back to a local plugin')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      const result = await client.market.mcp.restoreMcpToLocal.mutate({ identifier });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Restored MCP plugin ${pc.bold(identifier)} to local${r?.id ? ` (${r.id})` : ''}`,
      );
    });

  // ── mine ──────────────────────────────────────────────

  withListOptions(mcp.command('mine').description('List my published MCP plugins'), SORTS, {
    category: false,
  }).action(async (options) => {
    const client = await getTrpcClient();
    const { category: _category, ...input } = parseListInput(options, SORTS);
    const result = await client.market.mcp.getMyMcpList.query(input);
    renderMarketList(result, options, 'No published MCP plugins found.');
  });
}
