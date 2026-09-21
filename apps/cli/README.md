# clocktrace

The `clocktrace` command: setup, start, stop, status, permissions, and mcp.
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
clocktrace --version     # print the CLI version
```

`setup` creates the database, writes
`~/Library/LaunchAgents/com.clocktrace.collector.plist`, starts the
Collector, and walks the three permissions. At the end it shows a
checklist of the four Hosts (Claude Code, Codex, Hermes Agent,
OpenClaw) with the ones found on this Mac pre-ticked, and registers
`clocktrace mcp` with each ticked one; `setup --hosts` picks the Hosts
without the checklist. Every other command but `mcp`
prints `not set up, run clocktrace setup` first. The Collector logs to
`~/Library/Logs/clocktrace/collector.log`.

## Settings

The `CLOCKTRACE_HELPER` and `CLOCKTRACE_DB` env vars and their defaults are
documented in `packages/collector/README.md`.

## Live checks

1. `pnpm --filter cli exec clocktrace setup`, answer `skip` to each prompt,
   then `launchctl print gui/$(id -u)/com.clocktrace.collector | grep "state ="`
   prints `state = running`.
2. `pnpm --filter cli exec clocktrace stop` twice prints `collector: stopped`
   twice; `start` twice prints `collector: running` twice.
3. `pnpm --filter cli exec clocktrace bogus` prints the usage line and exits 1.
4. `CLOCKTRACE_HELPER=/nope/clocktrace-helper pnpm --filter cli exec clocktrace status`
   prints `helper not found at /nope/clocktrace-helper` and exits 1.
