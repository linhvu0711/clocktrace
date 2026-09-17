# Clocktrace

Automatic time tracking for a Mac, queried through an AI agent instead of a UI. See `CONTEXT.md` for the language and `docs/adr` for the decisions.

## Develop

Needs Node 22.12 or newer and pnpm 9 (`corepack enable` gives you the pinned version).

```sh
pnpm install
pnpm build
pnpm test
```

`pnpm lint` runs Biome. CI runs all of the above on macOS for every push and pull request.

## Layout

Things a person or an AI app starts go in `apps`. Things our own code imports go in `packages`.

| Path | What it is |
| --- | --- |
| `packages/core` | Activities, categories, projects, rules, queries, storage. Imported by every app. |
| `apps/cli` | The `clocktrace` command. |
| `apps/mcp` | The MCP server a Host starts. |

Every package extends `tsconfig.base.json`, is linted by the root `biome.json`, and has its own `build` and `test` scripts. Adding a package needs no root change: create it under `apps` or `packages` and pnpm picks it up.

The root lists `@clocktrace/cli` as a dev dependency only so the `clocktrace` bin is linked at the workspace root. After `pnpm build`, `pnpm --filter cli exec clocktrace --version` prints the CLI version.
