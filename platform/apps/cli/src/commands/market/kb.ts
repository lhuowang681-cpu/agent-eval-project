import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm } from '../../utils/format';
import { log } from '../../utils/logger';
import { parseListInput, renderMarketDetail, renderMarketList, withListOptions } from './common';

const SORTS = ['recommended', 'installCount', 'updatedAt'] as const;

export function registerMarketKbCommand(market: Command) {
  const kb = market.command('kb').description('Browse, install and publish market knowledge bases');

  // ── list ──────────────────────────────────────────────

  withListOptions(kb.command('list').description('List market knowledge bases'), SORTS, {
    category: false,
  }).action(async (options) => {
    const client = await getTrpcClient();
    const { category: _category, ...input } = parseListInput(options, SORTS);
    const result = await client.market.getKnowledgeBaseList.query(input);
    renderMarketList(result, options, 'No market knowledge bases found.');
  });

  // ── view ──────────────────────────────────────────────

  kb.command('view <identifier>')
    .description('View market knowledge base details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (identifier: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.getKnowledgeBaseDetail.query({ identifier });

      if (!result) {
        log.error(`Market knowledge base not found: ${identifier}`);
        process.exit(1);
        return;
      }

      renderMarketDetail(result, options);
    });

  // ── install ───────────────────────────────────────────

  kb.command('install <identifier>')
    .alias('i')
    .description('Install a market knowledge base into my account')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      const result = await client.market.knowledgeBase.installKnowledgeBase.mutate({ identifier });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Installed knowledge base ${pc.bold(identifier)}${r?.id ? ` (${r.id})` : ''}`,
      );
    });

  // ── upgrade ───────────────────────────────────────────

  kb.command('upgrade <identifier>')
    .description('Update my installed copy to the latest market version')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      await client.market.knowledgeBase.updateInstalledKnowledgeBase.mutate({ identifier });
      console.log(`${pc.green('✓')} Upgraded installed knowledge base ${pc.bold(identifier)}`);
    });

  // ── publish ───────────────────────────────────────────

  kb.command('publish <knowledgeBaseId>')
    .description('Publish a local knowledge base to the market')
    .option('--name <displayName>', 'Publish under a new display name')
    .action(async (knowledgeBaseId: string, options: { name?: string }) => {
      const client = await getTrpcClient();

      if (options.name) {
        const conflict = await client.market.knowledgeBase.checkPublishNameConflict.query({
          displayName: options.name,
        });
        if ((conflict as any)?.conflict) {
          log.error(`Display name already taken: ${options.name}`);
          process.exit(1);
          return;
        }
      }

      const result = await client.market.knowledgeBase.publishKnowledgeBase.mutate({
        knowledgeBaseId,
        newDisplayName: options.name,
      });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Published knowledge base ${pc.bold(r?.identifier || knowledgeBaseId)} to the market`,
      );
    });

  // ── update (republish) ────────────────────────────────

  kb.command('update <identifier>')
    .description('Republish the latest local version of my published knowledge base')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      await client.market.knowledgeBase.updateKnowledgeBase.mutate({ identifier });
      console.log(`${pc.green('✓')} Updated published knowledge base ${pc.bold(identifier)}`);
    });

  // ── delist ────────────────────────────────────────────

  kb.command('delist <identifier>')
    .description('Delist my published knowledge base from the market')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (identifier: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delist this knowledge base?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.knowledgeBase.delistKnowledgeBase.mutate({ identifier });
      console.log(`${pc.green('✓')} Delisted knowledge base ${pc.bold(identifier)}`);
    });

  // ── relist ────────────────────────────────────────────

  kb.command('relist <identifier>')
    .description('Relist my delisted knowledge base on the market')
    .option('--name <displayName>', 'New display name')
    .action(async (identifier: string, options: { name?: string }) => {
      const client = await getTrpcClient();
      await client.market.knowledgeBase.relistKnowledgeBase.mutate({
        displayName: options.name,
        identifier,
      });
      console.log(`${pc.green('✓')} Relisted knowledge base ${pc.bold(identifier)}`);
    });

  // ── mine ──────────────────────────────────────────────

  withListOptions(kb.command('mine').description('List my published knowledge bases'), SORTS, {
    category: false,
  }).action(async (options) => {
    const client = await getTrpcClient();
    const { category: _category, ...input } = parseListInput(options, SORTS);
    const result = await client.market.knowledgeBase.getMyKnowledgeBaseList.query(input);
    renderMarketList(result, options, 'No published knowledge bases found.');
  });
}
