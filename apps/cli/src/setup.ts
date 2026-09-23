import { homedir } from "node:os";

import {
  type App,
  type AppError,
  type AppMissingError,
  CollectorPaths,
  configuredDbPath,
  Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  helperPathConfig,
  type LaunchdError,
  Lifecycle,
} from "@clocktrace/collector";
import type { DatabaseNewerError, StoreError } from "@clocktrace/core";
import { Command, Options } from "@effect/cli";
import type {
  CommandExecutor,
  FileSystem,
  Path,
  Terminal,
} from "@effect/platform";
import { type DateTime, Effect, Option } from "effect";
import type { ParseError } from "effect/ParseResult";

import { columns, line, mark, Style, shortPath, span } from "./format.js";
import {
  type HostName,
  Hosts,
  hostLabel,
  hostNames,
  hostTitle,
  manualCommand,
  UnknownHostError,
} from "./hosts.js";
import { ReportedError } from "./output.js";
import { walkPermissions } from "./permissions.js";
import { Prompt, type Stdin, type StoppedError } from "./prompt.js";
import { withStore } from "./set-up.js";

const printManualCommands: Effect.Effect<void, never, Prompt> = Effect.gen(
  function* () {
    const prompt = yield* Prompt;
    for (const host of hostNames) {
      yield* prompt.print(`${hostLabel[host]}: ${manualCommand[host]}`);
    }
  },
);

type HostBorders = FileSystem.FileSystem | CommandExecutor.CommandExecutor;

const registerHosts = (
  hosts: ReadonlyArray<HostName>,
): Effect.Effect<void, never, Hosts | Prompt | HostBorders | Style> =>
  Effect.gen(function* () {
    const hostsService = yield* Hosts;
    const prompt = yield* Prompt;
    const look = yield* Style;
    for (const host of hosts) {
      const result = yield* hostsService.register(host);
      const row =
        result.outcome === "failed"
          ? [
              mark("bad", look),
              ` ${hostTitle[host]} failed · run by hand: ${result.byHand}`,
            ]
          : [mark("ok", look), ` ${hostTitle[host]} registered`];
      yield* prompt.print(line(["  ", ...row], look));
    }
  });

const pickHosts: Effect.Effect<
  ReadonlyArray<HostName>,
  StoppedError,
  Hosts | Prompt | HostBorders | Terminal.Terminal | Path.Path
> = Effect.gen(function* () {
  const hostsService = yield* Hosts;
  const prompt = yield* Prompt;
  const detected = yield* hostsService.detect();
  const picked = yield* prompt.checklist({
    message: "Hosts  ↑↓ move · space toggle · enter register",
    choices: hostNames.map((h) => ({
      title: hostTitle[h],
      value: h,
      ...(detected[h] ? { description: "found" as const, selected: true } : {}),
    })),
  });
  if (picked.length === 0) {
    yield* prompt.print("no host picked");
  }
  return picked;
});

export const setup = (
  hosts?: ReadonlyArray<HostName>,
): Effect.Effect<
  void,
  | HelperNotFoundError
  | HelperExitedError
  | AppError
  | AppMissingError
  | ParseError
  | StoreError
  | DatabaseNewerError
  | LaunchdError
  | ReportedError
  | StoppedError,
  | Prompt
  | Stdin
  | Helper
  | App
  | Lifecycle
  | CollectorPaths
  | Hosts
  | FileSystem.FileSystem
  | CommandExecutor.CommandExecutor
  | Terminal.Terminal
  | Path.Path
  | DateTime.CurrentTimeZone
  | Style
> =>
  Effect.gen(function* () {
    const helper = yield* Helper;
    const helperPath = yield* Effect.orDie(helperPathConfig);
    yield* helper.check(helperPath);
    const databasePath = yield* Effect.orDie(configuredDbPath);
    yield* withStore(
      Effect.gen(function* () {
        const lifecycle = yield* Lifecycle;
        const prompt = yield* Prompt;
        const look = yield* Style;
        const { appPath, plistPath, logPath } = yield* CollectorPaths;
        const home = homedir();
        yield* prompt.print(line([span("head", "Collector")], look));
        const collectorRows = columns(
          [
            [
              ["  ", mark("ok", look), " app"],
              span("dim", shortPath(appPath, home)),
            ],
            [
              ["  ", mark("ok", look), " launch agent"],
              span("dim", shortPath(plistPath, home)),
            ],
            [["  ", mark("ok", look), " running"]],
          ],
          look,
        );
        yield* lifecycle
          .install(
            { helperPath, databasePath },
            {
              done: (step) =>
                prompt.print(collectorRows[step === "app" ? 0 : 1] ?? ""),
              starting: (wait) => prompt.wait("  starting collector…", wait),
            },
          )
          .pipe(
            Effect.catchTag("CollectorNotLoadedError", (e) =>
              Effect.gen(function* () {
                if (!e.appRestored) {
                  yield* prompt.print(
                    "app: could not restore the previous install",
                  );
                }
                yield* prompt.printError(
                  line(
                    e.cause.step.startsWith("launchctl")
                      ? [
                          "  ",
                          mark("bad", look),
                          " collector did not start · see ",
                          span("dim", shortPath(logPath, home)),
                        ]
                      : ["  ", mark("bad", look), ` ${e.cause.message}`],
                    look,
                  ),
                );
                return yield* new ReportedError({ cause: e.cause });
              }),
            ),
          );
        yield* prompt.print(collectorRows[2] ?? "");
        const interactive = yield* prompt.interactive;
        yield* walkPermissions();
        const selected =
          hosts !== undefined ? hosts : interactive ? yield* pickHosts : [];
        if (selected.length === 0) {
          yield* printManualCommands;
        } else {
          yield* registerHosts(selected);
        }
        yield* prompt.print("");
        yield* prompt.print(
          line(
            [
              "Done. Database at ",
              span("dim", shortPath(databasePath, home)),
              ". Run ",
              span("head", "clocktrace status"),
              " any time.",
            ],
            look,
          ),
        );
      }),
    );
  });

const hostsOption = Options.text("hosts").pipe(
  Options.optional,
  Options.withDescription(
    "register these hosts without the checklist: claude, codex, hermes, openclaw",
  ),
);

export const setupCommand = Command.make(
  "setup",
  { hosts: hostsOption },
  ({ hosts }) =>
    Effect.gen(function* () {
      if (Option.isNone(hosts)) {
        return yield* setup();
      }
      const names = hosts.value
        .split(",")
        .map((h) => h.trim())
        .filter((h) => h !== "");
      const invalid = names.filter((h) => hostNames.every((n) => n !== h));
      if (names.length === 0 || invalid.length > 0) {
        return yield* new UnknownHostError({ names: invalid });
      }
      yield* setup(names as ReadonlyArray<HostName>);
    }),
).pipe(
  Command.withDescription("install the collector and register your AI hosts"),
);
