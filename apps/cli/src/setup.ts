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

import type { Style } from "./format.js";
import {
  type HostName,
  Hosts,
  hostLabel,
  hostNames,
  hostTitle,
  manualCommand,
  UnknownHostError,
} from "./hosts.js";
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
): Effect.Effect<void, never, Hosts | Prompt | HostBorders> =>
  Effect.gen(function* () {
    const hostsService = yield* Hosts;
    const prompt = yield* Prompt;
    for (const host of hosts) {
      yield* prompt.print(yield* hostsService.register(host));
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
// bootout takes longer than the fresh-install path, so the window covers it.
const defaultLoadRetry = Schedule.recurs(60).pipe(
  Schedule.addDelay(() => "100 millis"),
);

export const setup = (
  hosts?: ReadonlyArray<HostName>,
  loadRetry: Schedule.Schedule<unknown, unknown> = defaultLoadRetry,
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
        const written = yield* app.install(helperPath);
        yield* prompt.print(`app: ${written} ${appPath}`);
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
          yield* prompt.print(`launchd agent: written ${plistPath}`);
          yield* launchd.state().pipe(
            Effect.flatMap((collector) =>
              collector === "running"
                ? Effect.void
                : new LaunchdError({
                    step: "launchctl bootstrap",
                    detail: "collector did not start",
                  }),
            ),
            Effect.retry({ schedule: loadRetry }),
          );
        }).pipe(Effect.tapError(() => restore.pipe(Effect.ignore)));
        // Outside the failure guard: a failed .old delete must not roll
        // back a Collector that is already running.
        yield* Effect.ignore(app.commit());
        const interactive = yield* prompt.interactive;
        if (!interactive) {
          yield* prompt.print("no terminal, skipping questions");
        }
        yield* walkPermissions();
        const selected =
          hosts !== undefined ? hosts : interactive ? yield* pickHosts : [];
        if (selected.length === 0) {
          yield* printManualCommands;
        } else {
          yield* registerHosts(selected);
        }
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
