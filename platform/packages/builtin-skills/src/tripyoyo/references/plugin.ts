const content = `# lh plugin - Plugin Management

Manage installed plugins (external tool integrations).

## Subcommands

- \`lh plugin list\` - List installed plugins
- \`lh plugin install -i <identifier> --manifest <json-or-file> [--type <type>] [--custom-params <json>] [--settings <json>]\` - Install plugin
- \`lh plugin uninstall <id> [--yes]\` - Uninstall plugin
- \`lh plugin update <id> [--manifest <json-or-file>] [--custom-params <json>] [--settings <json>]\` - Update plugin
- \`lh plugin sync <id> [--json]\` - Probe a custom HTTP MCP plugin's live server and sync its real tool list into the manifest

## Tips

- Plugins extend agent capabilities with external tools
- \`--manifest\` accepts either an inline JSON string or a path to a JSON file — same on \`plugin\` and
  \`market mcp publish/update\`
- Use \`--settings\` to pass JSON configuration during install/update
- For an MCP plugin, the real connection info (\`url\`/\`type\`/\`headers\`/\`auth\`) MUST go in \`--custom-params\`
  as \`{"mcp":{"type":"http","url":"..."}}\` — putting it only in \`--manifest\` is not enough. Runtime
  connection, market publish previews, and \`plugin sync\` all read \`customParams.mcp\`, never \`manifest.mcp\`.
- After installing an MCP from a static config file (i.e. not through a live "test connection" step), its
  manifest has no real tool list yet — run \`lh plugin sync <id>\` first so the tool list isn't empty before
  publishing it with \`lh market mcp publish\`.

## Manifest Schema

\`--manifest\` (on \`plugin install/update\` and \`market mcp publish/update\`) takes a LobeChatPluginManifest
JSON object. The connection info (\`url\`/\`type\`/\`headers\`/\`auth\`) does NOT go here — it goes in
\`--custom-params\` (see above). The manifest carries metadata and the tool list:

\`\`\`json
{
  "name": "my-mcp",
  "description": "Short one-line description",
  "meta": {
    "title": "My MCP",
    "description": "Short one-line summary (used as the market listing subtitle)",
    "readme": "# My MCP\\n\\nLong-form readme in Markdown. This is what shows up on the market detail page — put the full documentation here, NOT in the top-level description.",
    "tags": ["data", "dict"],
    "avatar": "https://example.com/icon.png",
    "avatarBackground": "#f5f5f5"
  },
  "tools": [
    {
      "name": "query_tables",
      "description": "Query database tables",
      "parameters": { "type": "object", "properties": { "db_name": { "type": "string" } }, "required": ["db_name"] }
    }
  ]
}
\`\`\`

Field notes:
- \`meta.avatar\` is the plugin icon — emoji string, image URL, or an uploaded asset URL. If omitted the
  market falls back to auto-generation.
- \`meta.avatarBackground\` is an optional CSS color (\`"#f5f5f5"\`, \`"rgba(0,0,0,0)"\`, etc.) used behind
  emoji/image icons in the local list and detail cards.
- \`meta.readme\` is the long-form readme; the market stores it as the listing overview and renders it on
  the detail page. The top-level \`description\` / \`meta.description\` is only the short one-line summary —
  do NOT put the full readme there. If a user gives you a manifest with a top-level \`readme\` field,
  move it under \`meta.readme\` before publishing.
- \`tools[]\` is usually NOT handwritten — after \`plugin install\`, run \`lh plugin sync <id>\` to probe
  the live MCP server and populate the real tool list (names, descriptions, JSON-Schema parameters)
  into the manifest. Hand-written tool entries are only a placeholder until \`sync\` overwrites them.
- \`meta.title\` overrides the display name; if omitted, the market uses the identifier (or the \`--name\`
  flag on \`publish\`).
- \`category\` at the manifest top level is ignored by \`market mcp publish\` — the category comes from the
  required \`-c\` flag. Keep the manifest about the plugin itself, not the market listing.
\`\`\`
`;

export default content;
