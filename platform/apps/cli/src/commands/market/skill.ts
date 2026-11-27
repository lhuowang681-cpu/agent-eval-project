import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm } from '../../utils/format';
import { log } from '../../utils/logger';
import { SKILL_PUBLISH_CATEGORIES, validateCategory } from './categories';
import { parseListInput, renderMarketDetail, renderMarketList, withListOptions } from './common';

const SORTS = ['recommended', 'installCount', 'updatedAt'] as const;

export function registerMarketSkillCommand(market: Command) {
  const skill = market.command('skill').description('Browse, install and publish market skills');

  // ── list ──────────────────────────────────────────────

  withListOptions(skill.command('list').description('List market skills'), SORTS).action(
    async (options) => {
      const client = await getTrpcClient();
      const result = await client.market.getSkillList.query(parseListInput(options, SORTS));
      renderMarketList(result, options, 'No market skills found.');
    },
  );

  // ── view ──────────────────────────────────────────────

  skill
    .command('view <identifier>')
    .description('View market skill details')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (identifier: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.getSkillDetail.query({ identifier });

      if (!result) {
        log.error(`Market skill not found: ${identifier}`);
        process.exit(1);
        return;
      }

      renderMarketDetail(result, options);
    });

  // ── install ───────────────────────────────────────────

  skill
    .command('install <identifier>')
    .alias('i')
    .description('Install a market skill into my account')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      const result = await client.market.skill.installSkill.mutate({ identifier });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Installed skill ${pc.bold(identifier)}${r?.id ? ` (${r.id})` : ''}`,
      );
    });

  // ── upgrade ───────────────────────────────────────────

  skill
    .command('upgrade <identifier>')
    .description('Update my installed copy to the latest market version')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      await client.market.skill.updateInstalledSkill.mutate({ identifier });
      console.log(`${pc.green('✓')} Upgraded installed skill ${pc.bold(identifier)}`);
    });

  // ── publish ───────────────────────────────────────────

  skill
    .command('publish <skillId>')
    .description('Publish a local skill to the market')
    .requiredOption('-c, --category <category>', `Category: ${SKILL_PUBLISH_CATEGORIES.join(', ')}`)
    .option('--name <displayName>', 'Publish under a new display name')
    .action(async (skillId: string, options: { category: string; name?: string }) => {
      const categoryError = validateCategory(options.category, SKILL_PUBLISH_CATEGORIES);
      if (categoryError) {
        log.error(categoryError);
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();

      if (options.name) {
        const conflict = await client.market.skill.checkPublishNameConflict.query({
          displayName: options.name,
        });
        if ((conflict as any)?.conflict) {
          log.error(`Display name already taken: ${options.name}`);
          process.exit(1);
          return;
        }
      }

      const result = await client.market.skill.publishSkill.mutate({
        category: options.category,
        newDisplayName: options.name,
        skillId,
      });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Published skill ${pc.bold(r?.identifier || skillId)} to the market`,
      );
    });

  // ── update (republish) ────────────────────────────────

  skill
    .command('update <identifier>')
    .description('Republish the latest local version of my published skill')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      await client.market.skill.updateSkill.mutate({ identifier });
      console.log(`${pc.green('✓')} Updated published skill ${pc.bold(identifier)}`);
    });

  // ── delist ────────────────────────────────────────────

  skill
    .command('delist <identifier>')
    .description('Delist my published skill from the market')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (identifier: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to delist this skill?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.skill.delistSkill.mutate({ identifier });
      console.log(`${pc.green('✓')} Delisted skill ${pc.bold(identifier)}`);
    });

  // ── relist ────────────────────────────────────────────

  skill
    .command('relist <identifier>')
    .description('Relist my delisted skill on the market')
    .option('-c, --category <category>', `New category: ${SKILL_PUBLISH_CATEGORIES.join(', ')}`)
    .option('--name <displayName>', 'New display name')
    .action(async (identifier: string, options: { category?: string; name?: string }) => {
      if (options.category) {
        const categoryError = validateCategory(options.category, SKILL_PUBLISH_CATEGORIES);
        if (categoryError) {
          log.error(categoryError);
          process.exit(1);
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.skill.relistSkill.mutate({
        category: options.category,
        displayName: options.name,
        identifier,
      });
      console.log(`${pc.green('✓')} Relisted skill ${pc.bold(identifier)}`);
    });

  // ── restore ───────────────────────────────────────────

  skill
    .command('restore <identifier>')
    .description('Restore my published skill back to a local skill')
    .action(async (identifier: string) => {
      const client = await getTrpcClient();
      const result = await client.market.skill.restoreSkillToLocal.mutate({ identifier });
      const r = result as any;
      console.log(
        `${pc.green('✓')} Restored skill ${pc.bold(identifier)} to local${r?.id ? ` (${r.id})` : ''}`,
      );
    });

  // ── mine ──────────────────────────────────────────────

  withListOptions(skill.command('mine').description('List my published skills'), SORTS, {
    category: false,
  }).action(async (options) => {
    const client = await getTrpcClient();
    const { category: _category, ...input } = parseListInput(options, SORTS);
    const result = await client.market.skill.getMySkillList.query(input);
    renderMarketList(result, options, 'No published skills found.');
  });
}
