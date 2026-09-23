# Coding standards

One rule per line. A rule a tool checks names the tool in brackets. The how lives in `docs/idioms/`, the why in `docs/adr/`.

## Names

- TypeScript files are `kebab-case`. [biome useFilenamingConvention]
- Types, classes, services, and schemas are `PascalCase`. [biome useNamingConvention]
- Functions are `camelCase`. [biome useNamingConvention]
- Values are `camelCase`, except schemas and layers, which are `PascalCase`.
- Error classes end in `Error`.
- Our own env vars are `CLOCKTRACE_UPPER_SNAKE`. Standard ones such as `NO_COLOR` and `TERM` keep their names.
- SQLite tables are plural `snake_case` (`app_names`). Columns are `snake_case` (`started_at`).
- Domain words follow `CONTEXT.md`, including its `Avoid` lists.

## Layout

- Things a person or a Host starts go in `apps`. Things our own code imports go in `packages`.
- Each TypeScript package is `src/` plus `test/`, extends `tsconfig.base.json`, is linted by the root `biome.json`, and has its own `build`, `typecheck`, and `test` scripts. Adding a package needs no root change.
- The Swift package is `packages/helper`. Its shape is in the Swift block below.
- `packages/core` imports no app.
- The MCP server is `packages/mcp`. A Host starts it through `clocktrace mcp`, so `apps/cli` imports it.
- Apps import `core` by its package name `@clocktrace/core`, never by path.
- Relative imports end in `.js`. [tsc NodeNext]

## Errors

- An expected failure is a tagged error in the `E` channel, never a `throw`. `docs/idioms/effect-errors.md` shows the shape.
- A real bug is a defect. It is not caught by tag.
- `Effect.tryPromise` always has a `catch` that returns a tagged error.
  Without it every failure is `UnknownException` and cannot be handled by tag.

## Logging

- Logs go through the Effect logger. Fields go on with `Effect.annotateLogs`.
- `Effect.logInfo` marks a step in the Collector's life: started, import done, a step skipped. `Effect.logWarning` marks a failure the Collector lives through.
- `console` is only for CLI output to the user, in `apps/cli`. [biome noConsole]
- Window titles and URLs are never written to a log.
  They are private data (`CONTEXT.md`, Private) and a log is a second copy on disk.

## Tests

- Tests run with Vitest and live in `test/<module>.test.ts` next to `src/`.
- Every exported function in `packages/core` has a test.
- `test/` is type-checked. `pnpm typecheck` runs `tsc -p tsconfig.json` over `src` and `test` in every package. `build` uses `tsconfig.build.json`, which emits `src` only. [tsc]
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
- Biome is pinned exact so formatting is the same on every machine and in CI. Everything else uses `^`; `pnpm-lock.yaml` fixes what is installed.
- A library has one version across all packages.
- A workspace dep is `workspace:^`, the form `pnpm add --workspace` writes.
- Embedded source under `repos/` follows the rules in the embed-source block of `CLAUDE.md`, including the bump steps.

## Config and secrets

- Settings come in through Effect `Config`, never `process.env` in code. `docs/idioms/effect-config.md` shows the shape.
  One exception: `packages/core/src/regex-budget.ts` sets recheck's `RECHECK_SYNC_BACKEND` for one call, because recheck reads its backend only from the env.
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

## Swift

Rules for `packages/helper`. Nothing above applies to Swift unless it is repeated here.

- Files and types are `PascalCase`. Functions and values are `camelCase`. The executable target is `clocktrace-helper`.
- Layout is SwiftPM: `Sources/HelperCore/` for logic, `Sources/clocktrace-helper/main.swift` for the entry point, `Tests/HelperCoreTests/` for tests. `package.json` holds only `build` (`swift build -c release`) and `test` (`swift test`) so `pnpm -r` reaches it.
- An expected failure is an exit code from the executable or an enum case in `HelperCore` (`UrlRead.missing`, `GrantState.denied`). No `throws` across the `HelperCore` API, no `try!`.
- stdout carries only JSON lines. stderr carries only text for a person. A window title or URL never goes to stderr.
- Tests are XCTest in `Tests/HelperCoreTests/<Type>Tests.swift`. Every file in `Sources/HelperCore` with logic is covered by one; `PermissionsTests` covers `Permissions` and `PermissionChecks`. `LiveReads`, `LivePermissionReads`, and `Emit` are the seam that fakes replace and are left out. `LiveBiomeReads` takes its root folder as a parameter (`BiomeReads.live(remotePath:)`) and is tested on a temp folder.
- System reads come in as structs of closures (`Reads`, `PermissionReads`) so a test can inject fakes. No mocks.
- No external SwiftPM dependencies. Apple frameworks only.
- Formatting: 2 spaces, trailing commas in multi-line literals. No formatter runs on Swift yet.

## CLI and MCP

- A CLI command is an `@effect/cli` `Command` in `apps/cli/src/<name>.ts`, and every MCP tool has one (ADR 0006).
- A CLI flag is `kebab-case` (`--group-by`).
- An MCP tool name is `snake_case` (`add_rule`, `list_categories`, `summary`). Its input fields are `camelCase` (`groupBy`).
- An MCP tool replies with one object: `structuredContent` matches its `outputSchema`, and the text part is the same object as JSON. A failure is `isError` with the error's message as the text.
- A tool that takes `range` replies with `range { from, to, zone }` first, the exact window used.
