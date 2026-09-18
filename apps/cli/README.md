# clocktrace

CLI for clocktrace. Runs the collector that turns `clocktrace-helper watch`
lines into Activities in the local SQLite store.

## Build

```bash
pnpm install
pnpm build
```

`pnpm build` at the repo root also builds the helper binary
(`packages/helper`, `swift build -c release`), which `clocktrace run`
needs.

## Commands

```bash
clocktrace --version   # print the CLI version
clocktrace run         # run the collector in the foreground
```

`clocktrace run` starts `clocktrace-helper watch`, registers this Mac as a
Device on first run, and writes Activities until Ctrl+C. The helper is
restarted with backoff if it exits. Logs go to the terminal the command
was started from.

## Settings

| Env var | Default |
| --- | --- |
| `CLOCKTRACE_HELPER` | `packages/helper/.build/release/clocktrace-helper` next to this package |
| `CLOCKTRACE_DB` | `~/Library/Application Support/clocktrace/clocktrace.db` |

## Live checks

1. `pnpm --filter cli exec clocktrace run`, wait for `collector started`,
   switch between apps for a few seconds each, then Ctrl+C. Activities
   appear in `activities` (`sqlite3 "$CLOCKTRACE_DB" "select * from activities"`),
   and one `mac` row appears in `devices`.
2. `CLOCKTRACE_HELPER=/nope/clocktrace-helper pnpm --filter cli exec clocktrace run`
   prints `helper not found at /nope/clocktrace-helper` and exits 1.
3. With `clocktrace run` running, `pkill -f "clocktrace-helper watch"` logs
   `helper exited, restarting` and the helper comes back under a new pid.
