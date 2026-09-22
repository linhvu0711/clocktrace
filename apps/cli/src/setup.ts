import { homedir } from "node:os";

import {
  App,
  type AppError,
  type AppMissingError,
  appMainPath,
  appPath,
  collectorPlist,
  dbPathConfig,
  entryPath,
  Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  helperPathConfig,
  Launchd,
  LaunchdError,
  logPath,
  plistPath,
} from "@clocktrace/collector";
import type { DatabaseNewerError, StoreError } from "@clocktrace/core";
import { Command, Options } from "@effect/cli";
import type {
  CommandExecutor,
  FileSystem,
  Path,
  Terminal,
} from "@effect/platform";
import { type DateTime, Effect, Option, Schedule } from "effect";
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
      const row = result.includes("failed")
        ? [
            mark("bad", look),
            ` ${hostTitle[host]} failed · run by hand: ${manualCommand[host]}`,
          ]
        : [
            mark("ok", look),
            result.endsWith("already registered")
              ? ` ${hostTitle[host]} already registered`
              : ` ${hostTitle[host]} registered`,
          ];
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

// launchctl bootstrap returns before a RunAtLoad agent has reached running,
// so poll the state for a bounded window instead of trusting one sample.
// A re-run boots the agent out first, and relaunching a KeepAlive job after
// bootout takes much longer than the fresh-install path, so the window is
// wall-clock bounded: a slow `launchctl print` must not eat the budget.
const defaultLoadRetry = Schedule.spaced("100 millis").pipe(
  Schedule.upTo("45 seconds"),
);

export const setup = (
  hosts?: ReadonlyArray<HostName>,
  loadRetry: Schedule.Schedule<unknown, unknown> = defaultLoadRetry,
  openRetry?: Schedule.Schedule<unknown, unknown>,
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
  | Launchd
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
    const databasePath = yield* Effect.orDie(dbPathConfig);
    yield* withStore(
      Effect.gen(function* () {
        const launchd = yield* Launchd;
        const prompt = yield* Prompt;
        const app = yield* App;
        const look = yield* Style;
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
        yield* app.install(helperPath);
        yield* prompt.print(collectorRows[0] ?? "");
        const installed = yield* launchd.isInstalled();
        const previous = installed ? yield* launchd.readPlist() : null;
        if (installed) {
          yield* launchd.bootout();
        }
        // A fresh install that fails is removed; a rewrite that fails
        // puts the previous app and agent back, unloading the new one
        // first so the old plist is the one launchd runs.
        const restore = launchd
          .uninstall()
          .pipe(
            Effect.andThen(
              app
                .rollback()
                .pipe(
                  Effect.catchAll(() =>
                    prompt.print("app: could not restore the previous install"),
                  ),
                ),
            ),
            Effect.andThen(
              previous === null ? Effect.void : launchd.install(previous),
            ),
          );
        yield* Effect.gen(function* () {
          yield* launchd.install(
            collectorPlist({
              app: appMainPath,
              node: process.execPath,
              entry: entryPath,
              databasePath,
              helperPath,
              logPath,
            }),
          );
          yield* prompt.print(collectorRows[1] ?? "");
          yield* prompt.wait(
            "  starting collector…",
            launchd.state().pipe(
              Effect.flatMap((collector) =>
                collector === "running"
                  ? Effect.void
                  : new LaunchdError({
                      step: "launchctl bootstrap",
                      detail: "collector did not start",
                    }),
              ),
              Effect.retry({ schedule: loadRetry }),
            ),
          );
        }).pipe(
          Effect.tapError(() => restore.pipe(Effect.ignore)),
          Effect.catchTag("LaunchdError", (e) =>
            prompt
              .printError(
                line(
                  [
                    "  ",
                    mark("bad", look),
                    " collector did not start · see ",
                    span("dim", shortPath(logPath, home)),
                  ],
                  look,
                ),
              )
              .pipe(
                Effect.andThen(Effect.fail(new ReportedError({ cause: e }))),
              ),
          ),
        );
        yield* prompt.print(collectorRows[2] ?? "");
        // Outside the failure guard: a failed .old delete must not roll
        // back a Collector that is already running.
        yield* Effect.ignore(app.commit());
        const interactive = yield* prompt.interactive;
        yield* walkPermissions({ openRetry });
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
