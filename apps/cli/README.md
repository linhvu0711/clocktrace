# clocktrace

The `clocktrace` command: setup, start, stop, status, permissions, mcp, and the Twins of the rule, category, project, and question tools (`rules`, `categories`, `projects`, `summary`, `timeline`, `activities`, `status --json`).
The Collector itself lives in `packages/collector` and runs as a per-user
launchd agent.

## Build

```bash
pnpm install
pnpm build
```

`pnpm build` at the repo root also builds the helper binary
(`packages/helper`, `swift build -c release`), which the Collector needs.

## Commands

```bash
clocktrace setup         # create the database, install the Collector, walk the permissions
clocktrace start         # start the Collector
clocktrace stop          # stop the Collector
clocktrace status        # Collector state, permissions, last Activity, database path
clocktrace permissions   # walk the three permissions again
clocktrace mcp           # serve MCP over stdio for a Host
clocktrace setup --hosts <list>   # register the MCP server with the named Hosts (no checklist)
clocktrace rules list [--json]                # one line per Rule: id, position, field compare value, effect target
clocktrace rules add --field <f> --compare <c> --value <v> --effect <e> [--target <id>] [--json]   # append a Rule; a category or project effect needs --target
clocktrace rules remove <id> [--json]         # remove a Rule
clocktrace categories list [--json]           # one line per Category: id, name, productive
clocktrace categories set --name <n> [--productive] [--id <id>] [--json]   # create, or update by id
clocktrace categories remove <id> [--json]    # remove a Category no Rule uses
clocktrace projects list [--json]             # one line per Project: id, name
clocktrace projects set --name <n> [--id <id>] [--json]   # create, or rename by id
clocktrace projects remove <id> [--json]      # remove a Project no Rule uses
clocktrace summary --from <d> --to <d> [--group-by category|project|app|device] [--device <id>] [--json]   # window and zone, then seconds per group and the total; --group-by defaults to category
clocktrace timeline --from <d> --to <d> [--device <id>] [--json]   # window, then one line per block: start, end, app, Category, Project
clocktrace activities --from <d> --to <d> [--device <id>] [--app <a>] [--limit <n>] [--json]   # window, then one line per Activity: start, end, app, title, URL; at most 200
clocktrace status --json   # the status tool's JSON
clocktrace --version     # print the CLI version
```

`setup` creates the database, writes `~/Applications/Clocktrace.app` — the
bundle that owns the macOS grants; it must not be moved — writes
`~/Library/LaunchAgents/com.clocktrace.collector.plist`, starts the
Collector, and walks the three permissions: one line per permission, a
`(Y/n)` question only for what can be granted now, and an offer to open
a closed browser first. At the end it shows a
checklist of the four Hosts (Claude Code, Codex, Hermes Agent,
OpenClaw) with the ones found on this Mac pre-ticked, and registers
`clocktrace mcp` with each ticked one; `setup --hosts` picks the Hosts
without the checklist. Every other command but `mcp`
prints `not set up, run clocktrace setup` first. The Collector logs to
`~/Library/Logs/clocktrace/collector.log`.

`rules`, `categories`, `projects`, `summary`, `timeline`, `activities`, and `status --json` are the Twins of the MCP tools
(ADR 0006): each calls the same core function as its tool, `--json`
prints exactly what the tool returns, an empty list prints `none`, and
a core error prints the tool's text and exits 1. A `compare` that holds
a space is quoted: `--compare "ends with"`. A `<d>` is a local date
`YYYY-MM-DD` or a local date-time `YYYY-MM-DDTHH:mm` in this Mac's zone;
words like `today` are not accepted. Every report starts with the day as
asked and its zone, `2026-09-22 whole day · Asia/Saigon`; an empty window
prints `no activity`; a row shows the start minute and the length, the
exact seconds and the ids are in `--json`.

## Settings

The `CLOCKTRACE_HELPER` and `CLOCKTRACE_DB` env vars and their defaults are
documented in `packages/collector/README.md`.

## Live checks

1. `pnpm --filter cli exec clocktrace setup`, answer the permission
   questions with Enter, `n`, Enter, then
   `launchctl print gui/$(id -u)/com.clocktrace.collector | grep "state ="`
   prints `state = running`.
2. `pnpm --filter cli exec clocktrace stop` twice prints `collector: stopped`
   twice; `start` twice prints `collector: running` twice.
3. `pnpm --filter cli exec clocktrace bogus` prints
   `Invalid subcommand for clocktrace - use one of 'setup', 'start', 'stop', 'status', 'permissions', 'mcp', 'rules', 'categories', 'projects', 'summary', 'timeline', 'activities'`
   and exits 1.
4. `rm -rf ~/Applications/Clocktrace.app` then
   `pnpm --filter cli exec clocktrace status` prints
   `app: missing, run clocktrace setup` with every permission `not checked`,
   and `pnpm --filter cli exec clocktrace permissions` prints
   `app: missing, run clocktrace setup` and exits 1.
5. `pnpm --filter cli exec clocktrace setup` again rewrites the app and the
   agent: `ls ~/Applications/Clocktrace.app` exists and
   `clocktrace status --json` prints `"app":"present"`.
6. `pnpm --filter cli exec clocktrace permissions | cat` prints
   `no terminal, skipping questions` once and exits 0.
