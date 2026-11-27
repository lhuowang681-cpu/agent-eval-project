import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm } from '../../utils/format';
import { log } from '../../utils/logger';
import { ASSISTANT_PUBLISH_CATEGORIES, validateCategory } from './categories';
import { parseListInput, renderMarketDetail, renderMarketList, withListOptions } from './common';

const SORTS = ['recommended', 'installCount', 'updatedAt'] as const;

export function registerMarketAgentCommand(market: Command) {
  const agent = market.command('agent').description('Browse, install and publish market agents');

  // ── list ──────────────────────────────────────────────

  withListOptions(agent.command('list').description('List market agents'), SORTS).action(
    async (options) => {
      const client = await getTrpcClient();
      const result = await client.market.getAssistantList.query(parseListInput(options, SORTS));
      renderMarketList(result, options, 'No market agents found.');
    },
  );

  // ── view ──────────────────────────────────────────────

  agent
    .command('view <identifier>')
    .description('View market agent details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (identifier: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.getAssistantDetail.query({ identifier });

      if (!result) {
        log.error(`Market agent not found: ${identifier}`);
        process.exit(1);
        return;
      }

      renderMarketDetail(result, options);
    });

  // ── install ───────────────────────────────────────────

  agent
    .command('install <identifier>')
    .alias('i')
    .description('Install a market agent into my account')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      const result = await client.market.agent.installAgent.mutate({ identifier });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Installed agent ${pc.bold(identifier)}${r?.id ? ` (${r.id})` : ''}`,
      );
    });

  // ── upgrade ───────────────────────────────────────────

  agent
    .command('upgrade <identifier>')
    .description('Update my installed copy to the latest market version')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      await client.market.agent.updateInstalledAgent.mutate({ identifier });
      console.log(`${pc.green('✓')} Upgraded installed agent ${pc.bold(identifier)}`);
    });

  // ── publish ───────────────────────────────────────────

  agent
    .command('publish <agentId>')
    .description('Publish a local agent to the market')
    .requiredOption(
      '-c, --category <category>',
      `Category: ${ASSISTANT_PUBLISH_CATEGORIES.join(', ')}`,
    )
    .option('--name <displayName>', 'Publish under a new display name')
    .option('--skills <identifiers>', 'Bundled skill identifiers (comma-separated)')
    .option('--mcps <identifiers>', 'Bundled MCP identifiers (comma-separated)')
    .option('--kbs <identifiers>', 'Bundled knowledge base identifiers (comma-separated)')
    .action(
      async (
        agentId: string,
        options: { category: string; kbs?: string; mcps?: string; name?: string; skills?: string },
      ) => {
        const categoryError = validateCategory(options.category, ASSISTANT_PUBLISH_CATEGORIES);
        if (categoryError) {
          log.error(categoryError);
          process.exit(1);
          return;
        }

        const client = await getTrpcClient();

        if (options.name) {
          const conflict = await client.market.agent.checkPublishNameConflict.query({
            displayName: options.name,
          });
          if ((conflict as any)?.conflict) {
            log.error(`Display name already taken: ${options.name}`);
            process.exit(1);
            return;
          }
        }

        const parseIds = (s?: string) =>
          s
            ? s
                .split(',')
                .map((v) => v.trim())
                .filter(Boolean)
            : [];

        const result = await client.market.agent.publishAgent.mutate({
          agentId,
          bundledKnowledgeBaseIdentifiers: parseIds(options.kbs),
          bundledMcpIdentifiers: parseIds(options.mcps),
          bundledSkillIdentifiers: parseIds(options.skills),
          category: options.category,
          newDisplayName: options.name,
        });
        const r = result as any;
        console.log(
          `${pc.green('✓')} Published agent ${pc.bold(r?.identifier || agentId)} to the market`,
        );
      },
    );

  // ── update (republish) ────────────────────────────────

  agent
    .command('update <identifier>')
    .description('Republish the latest local version of my published agent')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      await client.market.agent.updateAgent.mutate({ identifier });
      console.log(`${pc.green('✓')} Updated published agent ${pc.bold(identifier)}`);
    });

  // ── delist ────────────────────────────────────────────

  agent
    .command('delist <identifier>')
    .description('Delist my published agent from the market')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (identifier: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delist this agent?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.agent.delistAgent.mutate({ identifier });
      console.log(`${pc.green('✓')} Delisted agent ${pc.bold(identifier)}`);
    });

  // ── relist ────────────────────────────────────────────

  agent
    .command('relist <identifier>')
    .description('Relist my delisted agent on the market')
    .option('-c, --category <category>', `New category: ${ASSISTANT_PUBLISH_CATEGORIES.join(', ')}`)
    .option('--name <displayName>', 'New display name')
    .action(async (identifier: string, options: { category?: string; name?: string }) => {
      if (options.category) {
        const categoryError = validateCategory(options.category, ASSISTANT_PUBLISH_CATEGORIES);
        if (categoryError) {
          log.error(categoryError);
          process.exit(1);
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.agent.relistAgent.mutate({
        category: options.category,
        displayName: options.name,
        identifier,
      });
      console.log(`${pc.green('✓')} Relisted agent ${pc.bold(identifier)}`);
    });

  // ── mine ──────────────────────────────────────────────

  withListOptions(agent.command('mine').description('List my published agents'), SORTS, {
    category: false,
  }).action(async (options) => {
    const client = await getTrpcClient();
    const { category: _category, ...input } = parseListInput(options, SORTS);
    const result = await client.market.agent.getMyAssistantList.query(input);
    renderMarketList(result, options, 'No published agents found.');
  });
}
