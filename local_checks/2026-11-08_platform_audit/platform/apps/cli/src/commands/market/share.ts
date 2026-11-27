import type { Command } from 'commander';
import pc from 'picocolors';

import { getTrpcClient } from '../../api/client';
import { confirm, outputJson, printTable, timeAgo, truncate } from '../../utils/format';
import { log } from '../../utils/logger';

const SHARE_TYPES = ['skill', 'mcp', 'agent'] as const;
type ShareType = (typeof SHARE_TYPES)[number];

export function registerMarketShareCommand(market: Command) {
  const share = market.command('share').description('Manage share links for my local resources');

  // ── create ────────────────────────────────────────────

  share
    .command('create <type> <localId>')
    .description(
      `Create a share link (type: ${SHARE_TYPES.join(', ')}; localId: agent id for agents, identifier for skills/MCP plugins)`,
    )
    .action(async (type: string, localId: string) => {
      if (!SHARE_TYPES.includes(type as ShareType)) {
        log.error(`Invalid type "${type}". Must be one of: ${SHARE_TYPES.join(', ')}`);
        process.exit(1);
        return;
      }

      const client = await getTrpcClient();
      const result = await client.market.share.create.mutate({
        itemType: type as ShareType,
        localId,
      });
      const r = result as any;
      console.log(`${pc.green('✓')} Created share link for ${type} ${pc.bold(localId)}`);
      if (r?.token) console.log(`Token: ${pc.bold(r.token)}`);
      if (r?.url) console.log(`URL: ${r.url}`);
    });

  // ── view ──────────────────────────────────────────────

  share
    .command('view <token>')
    .description('View a shared resource by token')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (token: string, options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.share.getByToken.query({ token });

      if (!result) {
        log.error(`Share not found: ${token}`);
        process.exit(1);
        return;
      }

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(result, fields);
        return;
      }

      const r = result as any;
      console.log(pc.bold(r.name || r.title || token));
      const meta: string[] = [];
      if (r.itemType) meta.push(r.itemType);
      if (r.installCount !== undefined) meta.push(`${r.installCount} installs`);
      if (r.createdAt) meta.push(`created ${timeAgo(r.createdAt)}`);
      if (meta.length > 0) console.log(pc.dim(meta.join(' · ')));
      if (r.description) {
        console.log();
        console.log(r.description);
      }
    });

  // ── list ──────────────────────────────────────────────

  share
    .command('list')
    .description('List my share links')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.market.share.myShares.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No share links found.');
        return;
      }

      const rows = items.map((s: any) => [
        s.token || '',
        s.itemType || '',
        truncate(s.name || s.title || s.localId || '', 30),
        String(s.installCount ?? 0),
        s.createdAt ? timeAgo(s.createdAt) : '',
      ]);

      printTable(rows, ['TOKEN', 'TYPE', 'NAME', 'INSTALLS', 'CREATED']);
    });

  // ── revoke ────────────────────────────────────────────

  share
    .command('revoke <token>')
    .description('Revoke a share link')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (token: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to revoke this share link?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.market.share.revoke.mutate({ token });
      console.log(`${pc.green('✓')} Revoked share link ${pc.bold(token)}`);
    });
}
