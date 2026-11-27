import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { outputJson, printTable, truncate } from '../../utils/format';
import { registerMarketAgentCommand } from './agent';
import { registerMarketKbCommand } from './kb';
import { registerMarketMcpCommand } from './mcp';
import { registerMarketShareCommand } from './share';
import { registerMarketSkillCommand } from './skill';

export function registerMarketCommand(program: Command) {
  const market = program
    .command('market')
    .description('Browse and manage the community market (agents, skills, MCP plugins, KBs)');

  registerMarketAgentCommand(market);
  registerMarketSkillCommand(market);
  registerMarketMcpCommand(market);
  registerMarketKbCommand(market);
  registerMarketShareCommand(market);

  // ── leaderboard ───────────────────────────────────────

  market
    .command('leaderboard')
    .description('Show the market usage leaderboard')
    .option('--days <days>', 'Time window in days', '30')
    .option('--limit <limit>', 'Entries per resource type (max 20)', '5')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { days?: string; json?: string | boolean; limit?: string }) => {
      const client = await getTrpcClient();
      const result = await client.market.getLeaderboard.query({
        days: Number(options.days) || 30,
        limit: Number(options.limit) || 5,
      });

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const sections: [string, any[]][] = [
        ['Agents', (result as any)?.agents ?? []],
        ['Skills', (result as any)?.skills ?? []],
        ['MCP Plugins', (result as any)?.mcps ?? []],
      ];

      for (const [title, entries] of sections) {
        console.log(pc.bold(title));
        if (entries.length === 0) {
          console.log(pc.dim('  No usage records.'));
        } else {
          const rows = entries.map((e: any, i: number) => [
            String(i + 1),
            e.identifier || '',
            truncate(e.title || e.name || '', 30),
            truncate(e.publisherName || '', 16),
            String(e.usageCount ?? 0),
          ]);
          printTable(rows, ['#', 'IDENTIFIER', 'TITLE', 'PUBLISHER', 'USAGE']);
        }
        console.log();
      }
    });

  // ── unpublished ───────────────────────────────────────

  market
    .command('unpublished')
    .description('List my local resources not yet published (or delisted) on the market')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.getUnpublishedResources.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      const rows: string[][] = [];
      const collect = (type: string, entries: any[] | undefined) => {
        for (const e of entries ?? []) {
          rows.push([
            type,
            e.id || '',
            truncate(e.name || e.title || e.displayName || e.identifier || '', 30),
            e.action || 'publish',
          ]);
        }
      };
      collect('agent', r?.agents);
      collect('skill', r?.skills);
      collect('mcp', r?.mcps);
      collect('kb', r?.knowledgeBases);

      if (rows.length === 0) {
        console.log('No unpublished resources found.');
        return;
      }

      printTable(rows, ['TYPE', 'ID', 'NAME', 'ACTION']);
    });

  // ── states ────────────────────────────────────────────

  market
    .command('states')
    .description('Show publish states of my market resources')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.getPublisherResourceStates.query();

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      const rows: string[][] = [];
      const collect = (type: string, entries: any[] | undefined) => {
        for (const e of entries ?? []) {
          rows.push([
            type,
            e.identifier || '',
            e.category || '',
            e.deletedAt ? 'delisted' : e.status || '',
          ]);
        }
      };
      collect('agent', r?.agents);
      collect('skill', r?.skills);
      collect('mcp', r?.mcps);
      collect('kb', r?.knowledgeBases);

      if (rows.length === 0) {
        console.log('No published resources found.');
        return;
      }

      printTable(rows, ['TYPE', 'IDENTIFIER', 'CATEGORY', 'STATUS']);
    });
}
