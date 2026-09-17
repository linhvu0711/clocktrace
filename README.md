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

<!-- embed-source:start -->
## Embedded library source

`repos/` holds a full copy of some dependencies' source, so coding agents can read the real implementation and tests instead of guessing from docs. `docs/idioms/` holds short notes that quote the idioms this project uses, with a path into `repos/` above each snippet. `CLAUDE.md` tells agents to start there.

| lib | version | fetched from |
| --- | --- | --- |
| effect | 3.22.2 | https://github.com/Effect-TS/effect at tag `effect@3.22.2` |

Rules:

- Never import from `repos/`. Import from the installed package.
- Never edit files under `repos/`. They are replaced wholesale on the next fetch.
- Lint, type-check, and tests skip `repos/`.

`repos/` is not in git. `pnpm install` runs `scripts/sync-repos.sh`, which reads the table in `repos/README.md` and does a shallow clone of each pinned tag. Run the script by hand if the folder is missing. Set `EMBED_SOURCE_SKIP=1` to skip the fetch.

After bumping a package, change its tag in `repos/README.md`, run `scripts/sync-repos.sh`, and change the version in this table, in the `CLAUDE.md` table, and in the first line of each `docs/idioms/effect-*.md` file.
<!-- embed-source:end -->
