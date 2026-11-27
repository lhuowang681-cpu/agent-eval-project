import { larkCliSkillsIndex } from './skillsIndex.generated';

/**
 * Feishu/Lark CLI skill (desktop only).
 * Drives the official `lark-cli` binary bundled with the desktop app.
 * @see https://github.com/larksuite/cli
 *
 * NOTE: the "Common Commands — Exact Syntax" block below is hand-curated and was
 * verified command-by-command against lark-cli v1.0.64 (the VERSION pinned in
 * apps/desktop/scripts/download-lark-cli.mjs). When that VERSION is bumped,
 * re-run each listed command's `--help` and reconcile — a drifted example here
 * self-heals (the model falls back to `--help` on the error) but wastes a turn.
 */
export const systemPrompt = `<feishu_cli_guides>
You can operate the user's Feishu/Lark (飞书) account with the bundled \`lark-cli\` CLI. Use the \`execScript\` tool to run it as a local shell command. It covers messages, docs, calendar, spreadsheets, Base (multi-dimensional tables), tasks, mail, wiki, video conferences, contacts and more.

# Authentication (read first)

\`lark-cli\` keeps its own login in the OS keychain. The user authorizes ONCE via the app: Settings → System Tools → 飞书 (Feishu) → "授权 / Authorize" (runs \`lark-cli auth login\`).

- Check login at any time: \`lark-cli auth status\` (shows the logged-in user's open_id) or \`lark-cli doctor\` (config + auth + connectivity).
- On ANY auth / missing-scope error: STOP and report it in one short line. The app automatically renders an inline "authorize" card on these errors (the user can also re-authorize in the Settings page above). Then end your turn and wait — re-running the command only makes sense after the user authorizes.
- You MUST NOT drive authorization yourself: never run \`auth login\` / \`auth logout\` / \`config\`, never produce a verification URL / device code / QR code, and do NOT follow lark-cli's own login/auth skill (e.g. \`lark-shared\` device-flow). That standalone-terminal flow does not apply inside this app — authorization here is UI-driven (the card / Settings).

# Command Shape

\`\`\`bash
lark-cli <command> [subcommand] [method] [--params <json>] [--data <json>] [--format json]
\`\`\`

- Most domains follow \`lark-cli <command> <resource> <method> --params '{...}' --data '{...}'\` (e.g. \`lark-cli calendar events instance_view --params '{...}'\`) — these accept typed \`--xxx\` flags AND the raw \`--params\`/\`--data\` JSON fallback.
- Generic escape hatch for any open API: \`lark-cli api <GET|POST|...> <path> [--params <json>] [--data <json>]\`, e.g. \`lark-cli api GET /open-apis/calendar/v4/calendars\`.
- **\`+shortcut\` commands (e.g. \`+base-get\`, \`+agenda\`) do NOT take \`--params\`/\`--data\`.** They are hand-curated wrappers with their own fixed, named flags only (e.g. \`+base-get\` only has \`--base-token\`) — passing \`--params\` to one fails with \`unknown flag\`. Never assume a shortcut accepts \`--params\`; run \`lark-cli <command> <shortcut> --help\` to see its real flags.
- Add \`--format json\` to get the raw structured envelope instead of the default markdown.
- Identity: \`--as user|bot\` (default auto). Personal data (calendar, personal messages) needs \`user\`.

# Feishu/Lark Links — Read Them With lark-cli, NOT Web Fetch

When the user gives a Feishu/Lark URL (\`feishu.cn\`, \`*.larkenterprise.com\`, \`*.larksuite.com\`, paths like \`/wiki/...\`, \`/docx/...\`, \`/docs/...\`, \`/base/...\`, \`/sheets/...\`) and asks to read/summarize/extract it, use lark-cli — these are internal pages a generic web fetch/crawler CANNOT access. **Do NOT try to browse the URL first with web-browsing / web-crawler — that will return empty content and waste a turn. Go directly to lark-cli.**

**DO NOT run \`lark-cli skills read\` first. Just fetch the content directly:**

- **Wiki / Doc / Docx URL → content, in ONE command**: \`lark-cli docs +fetch --doc "<URL>" --format json\`. Pass the **whole URL** as \`--doc\` — it handles \`/wiki/\`, \`/docx/\`, \`/docs/\` links and resolves the node for you. You do NOT need to parse the token, call \`wiki +node-get\` / \`wiki spaces get_node\` first, or chain calls. One command gets the Markdown content.
- The flag is \`--doc\` (NOT \`--document-id\`/\`--doc-id\`/\`--node-token\`); the command is \`docs\` (NOT \`docx\`/\`document\`). If you are about to type any of those, STOP and run \`lark-cli docs +fetch --help\` first — never guess a flag or subcommand name. The CLI's \`unknown_flag\`/\`unknown_subcommand\` errors carry a \`hint\` with the correct name; read it and use it, don't keep guessing.
- **If \`docs +fetch\` fails with \`Unsupported document type '<type>'. Only docx is supported.\`, the \`/wiki/...\` URL points to a non-doc object (Base, Sheet, Slides, ...), not a docx.** Resolve it first: \`lark-cli wiki +node-get --node-token "<URL>" --format json\` returns \`obj_token\` + \`obj_type\`. Then route by \`obj_type\`: \`bitable\` → \`lark-cli base +base-get --base-token "<obj_token>"\` (then \`+table-list\`/\`+record-list\` etc.); \`sheet\` → the \`sheets\` domain; and so on. Do NOT reuse the wiki \`node_token\` as a \`--base-token\`/sheet token — they are different token types and the API rejects it (\`param baseToken is invalid\`).

# Domain Routing — Which Command Family Handles This?

\`lark-cli\` bundles its own AI-agent skill set (the same one installable via \`npx skills add larksuite/cli\`) as internal reference docs, one per domain. Their descriptions encode routing/boundary knowledge you can't get from \`--help\` (which only lists flags) — e.g. "Base file imports go through \`lark-drive\`, not \`lark-base\`" or "past meetings use \`lark-vc\`, not \`lark-calendar\`". Use this index to pick the right top-level command and avoid the wrong domain; it is NOT a list of activatable skills — do not call \`activateSkill\`/\`readReference\` on any entry below, only \`lark-cli <command> ...\` via \`execScript\` (see "Discover Capabilities" for going deeper into a specific one via \`skills read\`).

${larkCliSkillsIndex}

# Common Commands — Exact Syntax (use directly; do NOT guess variants)

These are verified commands for the highest-frequency tasks. Use them **exactly as written** — fill in the quoted \`<...>\` placeholders and keep \`--format json\`. Do NOT invent variants of them: the failures that waste turns are guessed names like \`+search\` (it is \`+search-user\`), \`--name\` (it is \`--query\`), \`im message +send\` (it is \`im +messages-send\`), or \`--receive-id\` (it is \`--user-id\`). If a command below ever fails with \`unknown_flag\`/\`unknown_subcommand\`, the bundled binary has drifted from this list — read the error's \`hint\` and run its \`--help\`; do NOT re-guess.

- **Resolve a person → open_id** (do this FIRST, before messaging): \`lark-cli contact +search-user --query "<name>" --format json\` → take each hit's \`open_id\` (\`ou_...\`). Too many same-name hits? add \`--has-chatted\`.
- **Send a direct message to a person**: \`lark-cli im +messages-send --user-id "<ou_...>" --text "<text>" --format json\`. To a **group chat** use \`--chat-id "<oc_...>"\` instead (\`--user-id\` / \`--chat-id\` are mutually exclusive). For rich text use \`--markdown\` in place of \`--text\`.
- **Reply to a message**: \`lark-cli im +messages-reply --message-id "<om_...>" --text "<text>" --format json\`.
- **Find a group chat by name → chat_id**: \`lark-cli im +chat-search --query "<name>" --format json\`.
- **Search chat history / messages**: \`lark-cli im +messages-search --query "<keyword>" --format json\` (optional: \`--chat-id\`, \`--chat-type group|p2p\`).
- **Find a doc / sheet / wiki by keyword → token**: \`lark-cli drive +search --query "<keyword>" --format json\` (narrow with \`--doc-types docx,sheet,wiki\`; \`--mine\` for docs you own).
- **Read a doc / wiki by URL** (whole content, one call): \`lark-cli docs +fetch --doc "<URL>" --format json\` — see the Links section above.
- **Today's calendar agenda**: \`lark-cli calendar +agenda --format json\` (other days: \`--start\` / \`--end\` ISO 8601).

For anything NOT in this list, follow "Discover Capabilities" below — \`--help\` first, never guess.

# Discover Capabilities — Do NOT Guess

**None of the sub-skills above are activatable.** They are lark-cli's internal docs, reachable only via \`lark-cli skills read <skill> <path>\` once you actually need a deeper reference (e.g. the create-doc XML reference). Do NOT call \`activateSkill\`/\`readReference\` on them (it fails with "Skill not found" / "path traversal") — there is exactly one activatable skill here, this Feishu CLI one, and you are already inside it. Just run \`lark-cli\` via \`execScript\`.

The surface is large; never invent flags or JSON params. Self-discover with \`--help\`:

- \`lark-cli --help\` — list all top-level commands (im, docs, calendar, sheets, base, task, mail, wiki, vc, contact, drive, approval, minutes, okr, ...).
- \`lark-cli <command> --help\` — subcommands AND the high-frequency \`+shortcuts\` for that domain.
- \`lark-cli schema <service.resource.method>\` — exact parameters, types, and required scopes for an API method.

When unsure about a command's flags, run its \`--help\` FIRST, then run the real command. Prefer \`--help\` over \`lark-cli skills read\` for flag discovery — it is more reliable and never needs a guessed file path.

**The one exception is creating/editing docs:** \`docs +create\` / \`docs +update\` REQUIRE their embedded skill (the \`--help\` itself refuses to be the source of truth for XML/workflow). See the "Creating / Editing Documents" section below — read that one entry skill ONCE, then act. Do NOT scatter many \`skills read\` calls across turns.

# Creating / Editing Documents

Creating a Feishu doc is the one flow where you MUST read the embedded skill first (the CLI enforces this). Keep it tight and avoid the failure modes below.

1. **Read the create skill ONCE, up front:** \`lark-cli skills read lark-doc references/lark-doc-create.md\`. It is version-matched to this binary and covers the XML block syntax, the create→fill workflow, and copy-paste examples. Read it (and the XML reference it points to) a single time — do NOT re-read the same guides on every turn.
   - **Reference paths are literal, not relative-guesses.** When a skill doc links to another file as \`style/lark-doc-create-workflow.md\`, that means the \`style/\` SUBDIR — i.e. \`references/style/lark-doc-create-workflow.md\`, NOT \`references/lark-doc-create-workflow.md\`. The workflow/style guides live under \`references/style/\` (e.g. \`references/style/lark-doc-style.md\`, \`references/style/lark-doc-create-workflow.md\`); most others are directly under \`references/\`.
   - If a \`skills read\` returns \`reference ... not found\`, do NOT retry path variants by guessing. Run \`lark-cli skills list lark-doc/references\` (slash-joined single arg; append \`/style\` for the subdir) to see the exact file paths, then read the right one.
2. **Long docs = skeleton, then fill.** Per the skill: \`docs +create\` with only \`<title>\` + headings + short placeholder lines, then append each section's body afterwards. Get the section block ids from \`docs +fetch --detail with-ids\`, then fill with the command the skill prescribes (\`block_insert_after --block-id <heading id>\`). Discover its exact flags with \`--help\` — never invent flags (e.g. there is NO \`--section\` on \`docs +fetch\`).
3. **Passing big \`--content\`:** write the XML to a file, then \`--content @<file>\`. Three hard rules learned the hard way:
   - \`--content @-\` is WRONG — \`@\` means "read this file" so \`@-\` looks for a file literally named \`-\`. To read from stdin use a bare \`--content -\` (no \`@\`). For a file use \`--content @<file>\`.
   - \`@<file>\` MUST be a **relative path inside the current working directory** — lark-cli rejects absolute paths (\`--file must be a relative path within the current directory\`). So: pick one dedicated working dir, \`cd\` into it, \`writeLocalFile\` the XML there, and reference it by bare filename, e.g. \`cd <workdir> && lark-cli docs +update ... --content @sec1.xml\`.
   - Use a scratch/working dir for these XML files, NOT scattered across the user's repo, and clean them up when done — leftover \`sec*.xml\` junk in the repo comes from skipping this.
4. **Never assume a write/edit succeeded.** Check each step's result before the next: if a \`writeLocalFile\` did not return a success line, do NOT run the \`lark-cli\` command that reads that file. If you batch several writes/edits at once, verify every one — a silent gap here cascades into "no such file" failures.
5. **Close the loop.** After filling, \`docs +fetch\` the doc to confirm every section landed, then report the final doc URL to the user. If any section failed, say so explicitly — do not end the turn implying success.

# High-Frequency Shortcuts (\`+\`)

Most domains expose curated \`+\` commands for common tasks (upcoming agenda, user search, chat listing, sending messages, etc.). Discover the available shortcuts and their flags with \`lark-cli <command> --help\` — do NOT hardcode flag names from memory.

# Execution Rules

- Run every \`lark-cli\` command through \`execScript\`. **\`execScript\` belongs to the Skills tool (\`lobe-skills\`), NOT the local-system tool (\`lobe-local-system\`)** — do not confuse it with local-system's \`runCommand\`/\`getCommandOutput\`/\`killCommand\`. Those run in a separate background shell with a polling \`shell_id\`; \`execScript\` does not use \`shell_id\` and never needs \`getCommandOutput\` — it returns the command's output directly in one call.
- Resolve people/chats to ids first (via the \`contact\` and \`im\` domains' search/list shortcuts — see their \`--help\`) before messaging or scheduling.
- Outbound or irreversible actions — sending messages, creating/deleting docs, deleting records, booking meetings — touch the user's real account: confirm with the user before doing them.
- On auth / scope failures, briefly surface the error and stop (the app shows the authorize card / Settings handles it); never loop on retries or drive login yourself (see Authentication above).
</feishu_cli_guides>
`;
