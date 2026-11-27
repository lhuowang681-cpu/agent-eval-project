import type { Command } from 'commander';
import pc from 'picocolors';

import { getToolsTrpcClient, getTrpcClient } from '../api/client';
import { confirm, outputJson, printTable, truncate } from '../utils/format';
import { parseJsonArg } from '../utils/json-arg';
import { log } from '../utils/logger';

export function registerPluginCommand(program: Command) {
  const plugin = program.command('plugin').description('Manage plugins');

  // ── list ──────────────────────────────────────────────

  plugin
    .command('list')
    .description('List installed plugins')
    .option('--json [fields]', 'Output JSON, optionally specify fields (comma-separated)')
    .action(async (options: { json?: string | boolean }) => {
      const client = await getTrpcClient();
      const result = await client.plugin.getPlugins.query();
      const items = Array.isArray(result) ? result : [];

      if (options.json !== undefined) {
        const fields = typeof options.json === 'string' ? options.json : undefined;
        outputJson(items, fields);
        return;
      }

      if (items.length === 0) {
        console.log('No plugins installed.');
        return;
      }

      const rows = items.map((p: any) => [
        p.id || '',
        truncate(p.identifier || '', 30),
        p.type || '',
        truncate(p.manifest?.meta?.title || p.manifest?.identifier || '', 30),
      ]);

      printTable(rows, ['ID', 'IDENTIFIER', 'TYPE', 'TITLE']);
    });

  // ── create ──────────────────────────────────────────

  plugin
    .command('create')
    .description('Create a new plugin (without settings)')
    .requiredOption('-i, --identifier <id>', 'Plugin identifier')
    .requiredOption(
      '--manifest <json-or-file>',
      'Plugin manifest JSON, inline or a path to a JSON file',
    )
    .option('--type <type>', 'Plugin type: plugin or customPlugin', 'plugin')
    .option('--custom-params <json>', 'Custom parameters JSON')
    .action(
      async (options: {
        customParams?: string;
        identifier: string;
        manifest: string;
        type: string;
      }) => {
        const manifest = await parseJsonArg(options.manifest, 'manifest');
        let customParams: any = {};
        if (options.customParams) {
          try {
            customParams = JSON.parse(options.customParams);
          } catch {
            log.error('Invalid custom-params JSON.');
            process.exit(1);
            return;
          }
        }

        const client = await getTrpcClient();
        const result = await client.plugin.createPlugin.mutate({
          customParams,
          identifier: options.identifier,
          manifest,
          type: options.type as 'plugin' | 'customPlugin',
        });

        const r = result as any;
        console.log(
          `${pc.green('✓')} Created plugin ${pc.bold(r.identifier || options.identifier)}`,
        );
      },
    );

  // ── install ───────────────────────────────────────────

  plugin
    .command('install')
    .description('Install a plugin')
    .requiredOption('-i, --identifier <id>', 'Plugin identifier')
    .requiredOption(
      '--manifest <json-or-file>',
      'Plugin manifest JSON, inline or a path to a JSON file',
    )
    .option('--type <type>', 'Plugin type: plugin or customPlugin', 'plugin')
    .option(
      '--custom-params <json>',
      'Custom parameters JSON (e.g. MCP connection: {"mcp":{"type":"http","url":"..."}})',
    )
    .option('--settings <json>', 'Plugin settings JSON')
    .action(
      async (options: {
        customParams?: string;
        identifier: string;
        manifest: string;
        settings?: string;
        type: string;
      }) => {
        const client = await getTrpcClient();

        const manifest = await parseJsonArg(options.manifest, 'manifest');
        let customParams: any = {};
        let settings: any;
        if (options.customParams) {
          try {
            customParams = JSON.parse(options.customParams);
          } catch {
            log.error('Invalid custom-params JSON.');
            process.exit(1);
          }
        }
        if (options.settings) {
          try {
            settings = JSON.parse(options.settings);
          } catch {
            log.error('Invalid settings JSON.');
            process.exit(1);
          }
        }

        await client.plugin.createOrInstallPlugin.mutate({
          customParams,
          identifier: options.identifier,
          manifest,
          settings,
          type: options.type as 'plugin' | 'customPlugin',
        });

        console.log(`${pc.green('✓')} Installed plugin ${pc.bold(options.identifier)}`);
      },
    );

  // ── uninstall ─────────────────────────────────────────

  plugin
    .command('uninstall <id>')
    .description('Uninstall a plugin')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (id: string, options: { yes?: boolean }) => {
      if (!options.yes) {
        const confirmed = await confirm('Are you sure you want to uninstall this plugin?');
        if (!confirmed) {
          console.log('Cancelled.');
          return;
        }
      }

      const client = await getTrpcClient();
      await client.plugin.removePlugin.mutate({ id });
      console.log(`${pc.green('✓')} Uninstalled plugin ${pc.bold(id)}`);
    });

  // ── update ────────────────────────────────────────────

  plugin
    .command('update <id>')
    .description('Update plugin settings, manifest or custom params')
    .option('--manifest <json-or-file>', 'New manifest JSON, inline or a path to a JSON file')
    .option(
      '--custom-params <json>',
      'New custom parameters JSON (e.g. MCP connection: {"mcp":{"type":"http","url":"..."}})',
    )
    .option('--settings <json>', 'New settings JSON')
    .action(
      async (
        id: string,
        options: { customParams?: string; manifest?: string; settings?: string },
      ) => {
        const input: Record<string, any> = { id };

        if (options.manifest) {
          input.manifest = await parseJsonArg(options.manifest, 'manifest');
        }
        if (options.customParams) {
          try {
            input.customParams = JSON.parse(options.customParams);
          } catch {
            log.error('Invalid custom-params JSON.');
            process.exit(1);
          }
        }
        if (options.settings) {
          try {
            input.settings = JSON.parse(options.settings);
          } catch {
            log.error('Invalid settings JSON.');
            process.exit(1);
          }
        }

        if (!options.manifest && !options.customParams && !options.settings) {
          log.error('No changes specified. Use --manifest, --custom-params or --settings.');
          process.exit(1);
        }

        const client = await getTrpcClient();
        await client.plugin.updatePlugin.mutate(input as any);
        console.log(`${pc.green('✓')} Updated plugin ${pc.bold(id)}`);
      },
    );

  // ── sync ──────────────────────────────────────────────

  plugin
    .command('sync <id>')
    .description(
      "Probe a custom HTTP MCP plugin's live server and sync its real tool list into the manifest",
    )
    .option('--json', 'Print the updated manifest as JSON instead of a summary')
    .action(async (id: string, options: { json?: boolean }) => {
      const client = await getTrpcClient();
      const items = (await client.plugin.getPlugins.query()) as any[];
      const plugin = items.find((p) => p.identifier === id);

      if (!plugin) {
        log.error(`Plugin not found: ${id}`);
        process.exit(1);
        return;
      }

      const connection = plugin.customParams?.mcp;
      if (!connection?.url) {
        log.error(
          'No customParams.mcp.url found on this plugin. Set the MCP connection first with ' +
            '\'plugin update <id> --custom-params \\\'{"mcp":{"type":"http","url":"..."}}\\\'\'.',
        );
        process.exit(1);
        return;
      }
      if (connection.type === 'stdio') {
        log.error('plugin sync only supports http/streamable MCP connections for now.');
        process.exit(1);
        return;
      }

      const toolsClient = await getToolsTrpcClient();
      const result = await toolsClient.mcp.getStreamableMcpServerManifest.query({
        auth: connection.auth,
        headers: connection.headers,
        identifier: id,
        metadata: {
          avatar: plugin.manifest?.meta?.avatar,
          description: plugin.manifest?.meta?.description,
          name: plugin.manifest?.meta?.title,
        },
        url: connection.url,
      });

      // The server's `metadata.name` passthrough is dropped by a schema gap
      // (GetStreamableMcpServerManifestInputSchema.metadata has no `name` field),
      // so the response always echoes back `title: identifier`. Keep the
      // existing display title instead of letting that clobber it.
      const manifest = {
        ...plugin.manifest,
        api: (result as any).api,
        meta: {
          ...plugin.manifest?.meta,
          ...(result as any).meta,
          title: plugin.manifest?.meta?.title || (result as any).meta?.title,
        },
      };

      await client.plugin.updatePlugin.mutate({ id, manifest });

      if (options.json) {
        outputJson(manifest);
        return;
      }

      const toolNames = ((result as any).api || []).map((t: any) => t.name).join(', ');
      console.log(
        `${pc.green('✓')} Synced ${pc.bold(String(((result as any).api || []).length))} tool(s) for ${pc.bold(id)}${toolNames ? `: ${toolNames}` : ''}`,
      );
    });
}
