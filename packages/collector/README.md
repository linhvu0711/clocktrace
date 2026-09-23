# @clocktrace/collector

The Collector: the loop that turns `clocktrace-helper watch` lines into
Activities, the Helper service, launchd control, permissions, and status.
`apps/cli` and `packages/mcp` import it.

## Entry

`dist/main.js` is started only by the launchd plist that `clocktrace setup`
writes. It is not a command.

## Settings

| Env var | Default |
| --- | --- |
| `CLOCKTRACE_HELPER` | `packages/helper/.build/release/clocktrace-helper` in the workspace; `helper/clocktrace-helper` at the root of an installed copy |
| `CLOCKTRACE_DB` | `~/Library/Application Support/clocktrace/clocktrace.db` |
