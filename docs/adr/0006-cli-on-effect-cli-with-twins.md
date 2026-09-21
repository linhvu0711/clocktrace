---
status: accepted
---

# The CLI reads argv with @effect/cli, and every MCP tool has a CLI twin

Everything a Host can do through an MCP tool, a person can do in the terminal (epic #3). Each tool gets a Twin: `add_rule` and `clocktrace rules add` call the same core function in `packages/core`, and neither side holds logic of its own; the only difference is the words they print. With thirteen tools the CLI grows to about fifteen commands with flags such as `--field`, `--from`, and `--json`, so the CLI reads argv with `@effect/cli`, one `Command` per command with `Options.choice` over the core literals and `--help` generated, instead of the one-token parser in `apps/cli/src/args.ts`.

## Considered options

- Extend the hand-written parser: rejected, every ticket would grow it with flags, choices, and help text the library already provides, and the next ticket copies whatever shape the first one picks.
- Logic in a Twin or in the server: rejected, a side that formats or checks on its own drifts from the other, and the person and the Host stop seeing the same thing.

## Consequences

- `@effect/cli` brings `@effect/printer` and `@effect/printer-ansi`. All three are pre-1.0 and move with `effect`, so a bump of `effect` bumps them in the same PR.
- A new MCP tool is not done until its Twin lands, and a new command is not done until its tool does.
