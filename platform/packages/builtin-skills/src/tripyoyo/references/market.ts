const content = `# lh market - Community Market

Browse, install and publish community market resources. Four resource types share the same subcommand set: \`agent\`, \`skill\`, \`mcp\`, \`kb\`.

## Identifier Conventions

- Market resources are addressed by \`identifier\` (e.g. \`agt_BNTvweY7\`, \`user.rvmd42y4vrBB\`, \`bat-mcp-function\`) — used by list/view/install/upgrade/update/delist/relist/restore
- \`publish\` takes the LOCAL id instead: agent \`agt_\` id, skill \`skl_\` id, kb \`kb_\` id; mcp publish takes the plugin identifier plus \`--manifest\`
- \`share create\` localId: agents take the \`agt_\` id; skills/MCP plugins take their identifier (NOT the \`skl_\` id)

## Consumer Subcommands (per resource type)

- \`lh market <agent|skill|mcp|kb> list [-q <kw>] [--category <c>] [--page <n>] [--size <n>] [--sort <s>]\` - Browse market
  - sort: \`recommended\` (default) | \`installCount\` | \`updatedAt\` (mcp also supports \`createdAt\`)
- \`lh market <type> view <identifier>\` - View details
- \`lh market <type> install <identifier>\` - Install into my account (alias: \`i\`)
- \`lh market <type> upgrade <identifier>\` - Update my installed copy to the latest market version
- \`lh market leaderboard [--days <n>] [--limit <n>]\` - Usage leaderboard (agents/skills/mcps)

Installed resources appear in the corresponding local list (e.g. \`lh skill list --source market\`); uninstall = delete the local copy.

## Publisher Subcommands (per resource type)

- \`lh market agent publish <agentId> -c <category> [--name <displayName>] [--skills a,b] [--mcps a,b] [--kbs a,b]\` - Publish with bundled deps
- \`lh market skill publish <skillId> -c <category> [--name <displayName>]\`
- \`lh market mcp publish <identifier> -c <category> --manifest <json-or-file> [--params <file.json>] [--name <displayName>]\` - Publish a local MCP plugin. The manifest carries the listing metadata (\`meta.title\`/\`meta.description\`/\`meta.readme\`/\`meta.tags\`) and tool list — see the **Manifest Schema** section under \`lh plugin\`. The full readme MUST go in \`meta.readme\` (it becomes the market detail page); the short summary goes in \`meta.description\`.
- \`lh market kb publish <kbId> [--name <displayName>]\` - kb has no category
- \`lh market <type> update <identifier>\` - Republish latest local version
- \`lh market <type> delist <identifier> [--yes]\` - Take down from market (reversible)
- \`lh market <type> relist <identifier> [-c <category>] [--name <displayName>]\` - Put back on market
- \`lh market <skill|mcp> restore <identifier>\` - Restore my published item back to a local resource
- \`lh market <type> mine [-q <kw>]\` - My published items
- \`lh market unpublished\` - My local resources not yet published (or delisted, pending relist)
- \`lh market states\` - Publish states of my market resources

## Share Links

- \`lh market share create <skill|mcp|agent> <localId>\` - Returns token + /share/<token> URL
- \`lh market share view <token>\`
- \`lh market share list\`
- \`lh market share revoke <token> [--yes]\`

## Valid Publish Categories (validated client-side)

- agent: data-analytics, product-manager, new-media, marketing, coding, designer, user-research, hr-finance, other
- skill: data-analytics, product-planning, content-creation, marketing, ops-analytics, design-creation, research-insight, report-writing, deep-thinking, other
- mcp: data-storage, collaboration, info-fetch, coding, business-system, user-feedback, design-assets, project-management, other

## Tips

- \`--manifest\` accepts either an inline JSON string or a path to a JSON file
- \`--name\` triggers a display-name conflict check; the command exits with an error on conflict
- delist keeps the record (invisible publicly) and relist restores it; restore pulls the published item back for local editing
- Publisher commands (publish/update/delist/relist/restore/mine/unpublished/states) require the caller to be the publisher
- \`mcp publish\`'s \`--manifest\` is metadata only; the actual connection (\`url\`/\`type\`/\`headers\`/\`auth\`) and
  real tool list must come from the local plugin's \`customParams.mcp\` and synced \`manifest.api\` — see
  \`lh plugin\` (\`--custom-params\`, \`plugin sync\`) before publishing an MCP installed from a static config
`;

export default content;
