const content = `# lh skill - Skill Management

Manage agent skills (reusable prompt+resource bundles).

## Subcommands

- \`lh skill list [--source <builtin|market|user>]\` - List skills
- \`lh skill view <id>\` - View skill details
- \`lh skill create -n <name> -d <description> -c <content>\` - Create user skill
- \`lh skill edit <id> [-c <content>] [-n <name>] [-d <description>]\` - Update skill
- \`lh skill delete <id> [--yes]\` - Delete skill
- \`lh skill search <query>\` - Search skills
- \`lh skill install <source> [--branch <b>]\` - Install from GitHub/URL/marketplace
- \`lh skill resources <id>\` - List skill resource files
- \`lh skill read-resource <id> <path>\` - Read a skill resource file

## Tips

- Skills can be installed from GitHub repos, URLs, or the marketplace
- Use \`resources\` and \`read-resource\` to inspect skill reference files

## SKILL.md Frontmatter

When importing a skill from a zip package, \`SKILL.md\` uses YAML frontmatter for metadata.
Beyond the required \`name\` / \`description\`, the following optional fields are recognized and
persisted into the skill manifest for display in the local list and market cards:

\`\`\`markdown
---
name: my-skill
description: Short one-line description
icon: "🧩"                    # emoji or image URL (falls back to legacy \`avatar\` if not set)
backgroundColor: "#f5f5f5"    # optional CSS color behind the icon
---

# My Skill

Long-form skill content here.
\`\`\`

- \`icon\` (or legacy \`avatar\`): emoji, image URL, or uploaded asset URL. Used as the card icon
  in the local skill list and the market listing.
- \`backgroundColor\`: any CSS color string (\`"#f5f5f5"\`, \`"rgba(0,0,0,0)"\`, etc.). Rendered
  behind the icon in local skill cards.
`;

export default content;
