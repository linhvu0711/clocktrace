# Clocktrace

Automatic time tracking for a Mac, queried through an AI agent instead of a UI.

## Develop

Requires Node 22+ and pnpm 9.

```sh
pnpm install
pnpm build
pnpm test
```

## Layout

Things a person or an AI app starts go in `apps`. Things our own code imports go in `packages`.

- `packages/core` — activities, categories, projects, rules, queries, storage
- `apps/cli` — the `clocktrace` command
- `apps/mcp` — the MCP server a Host starts
