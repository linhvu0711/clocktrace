# Coding standards

One rule per line. A rule a tool checks names the tool in brackets. The how lives in `docs/idioms/`, the why in `docs/adr/`.

## Names

- Files are `kebab-case`. [biome useFilenamingConvention]
- Types, classes, services, and schemas are `PascalCase`. [biome useNamingConvention]
- Functions are `camelCase`. [biome useNamingConvention]
- Values are `camelCase`, except schemas and layers, which are `PascalCase`.
- Error classes end in `Error`.
- Env vars are `CLOCKTRACE_UPPER_SNAKE`.
- Domain words follow `CONTEXT.md`, including its `Avoid` lists.

## Layout

- Things a person or a Host starts go in `apps`. Things our own code imports go in `packages`.
- Each package is `src/` plus `test/`, extends `tsconfig.base.json`, is linted by the root `biome.json`, and has its own `build` and `test` scripts. Adding a package needs no root change.
- `packages/core` imports no app.
- Apps import `core` by its package name `@clocktrace/core`, never by path.
- Relative imports end in `.js`. [tsc NodeNext]

## Errors

- An expected failure is a tagged error in the `E` channel, never a `throw`. `docs/idioms/effect-errors.md` shows the shape.
- A real bug is a defect. It is not caught by tag.
- `Effect.tryPromise` always has a `catch` that returns a tagged error.
  Without it every failure is `UnknownException` and cannot be handled by tag.

## Logging

- Logs go through the Effect logger. Fields go on with `Effect.annotateLogs`.
- `console` is only for CLI output to the user, in `apps/cli`. [biome noConsole]
- Window titles and URLs are never written to a log.
  They are private data (`CONTEXT.md`, Private) and a log is a second copy on disk.

## Tests

- Tests run with Vitest and live in `test/<module>.test.ts` next to `src/`.
- Every exported function in `packages/core` has a test.
- Each Importer has a golden test on one real sample file (ADR 0004).
- Effect code runs in a test with `Effect.runSync` or `Effect.runPromise`.
  `@effect/vitest` needs Vitest 3 and the repo is on Vitest 5.

## Commits

- A commit subject is Conventional Commits: `type: subject`.
- A branch is `type/<issue>-slug`, or `type/slug` when there is no issue.
- A PR is one change and is squash-merged, so the PR title is the commit.

## Deps

- A dep is added with `pnpm add --filter <package> <dep>`, never by editing JSON by hand.
- `pnpm-lock.yaml` is committed and CI installs with `--frozen-lockfile`.
- Tools that check or format code are pinned exact. Libraries use `^`.
  Exact keeps the formatter the same on every machine and in CI.
- A library has one version across all packages.
- Embedded source under `repos/` follows the rules in the embed-source block of `CLAUDE.md`, including the bump steps.

## Config and secrets

- Settings come in through Effect `Config`, never `process.env` in code. `docs/idioms/effect-config.md` shows the shape.
- A secret is read with `Config.redacted` so it never prints.
- `.env*` and `*.db` files never enter git. [.gitignore]

## Formatting

- Formatting is Biome's job: 2 spaces, 80 columns, double quotes, semicolons, trailing commas. `pnpm lint:fix` applies it. [biome]
- `.editorconfig` mirrors those values for editors without Biome.

## Stack-specific

- `tsconfig.base.json` is strict, with `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`. [tsc]
- A service is `Effect.Service<Self>()` with a static `Test` layer. `docs/idioms/effect-services.md` shows the shape.
- A domain shape is one `Schema`, and the TypeScript type comes from it. No side `interface`. `docs/idioms/effect-schema.md` shows the shape.
- Plain TypeScript is used only at the edges where the MCP SDK or a native binding wants it (ADR 0003).

## Not covered

- API shape (MCP tool names, CLI subcommand names): left out until the first MCP tool lands.
