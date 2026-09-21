import {
  collectorPlist,
  dbPathConfig,
  entryPath,
  Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  helperPathConfig,
  Launchd,
  type LaunchdError,
  logPath,
  plistPath,
} from "@clocktrace/collector";
import type { DatabaseNewerError, StoreError } from "@clocktrace/core";
import type { CommandExecutor, FileSystem } from "@effect/platform";
import { type DateTime, Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type HostName,
  Hosts,
  hostLabel,
  hostNames,
  manualCommand,
} from "./hosts.js";
import { walkPermissions } from "./permissions.js";
import { Prompt } from "./prompt.js";
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
  never,
  Hosts | Prompt | HostBorders
> = Effect.gen(function* () {
  const hostsService = yield* Hosts;
  const prompt = yield* Prompt;
  const detected = yield* hostsService.detect();
  const ticked = new Set<HostName>(hostNames.filter((h) => detected[h]));
  if (ticked.size === 0) {
    return [];
  }
  for (;;) {
    let i = 0;
    for (const host of hostNames) {
      i += 1;
      yield* prompt.print(
        `${i}. ${ticked.has(host) ? "[x]" : "[ ]"} ${hostLabel[host]}`,
      );
    }
    const answer = yield* prompt.ask("numbers toggle, enter to register > ");
    if (answer.trim() === "") {
      break;
    }
    for (const part of answer.split(/[\s,]+/)) {
      const host = hostNames[Number(part) - 1];
      if (host === undefined) {
        continue;
      }
      if (ticked.has(host)) {
        ticked.delete(host);
      } else {
        ticked.add(host);
      }
    }
  }
  return [...ticked];
});

export const setup = (
  hosts?: ReadonlyArray<HostName>,
): Effect.Effect<
  void,
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | DatabaseNewerError
  | LaunchdError,
  | Prompt
  | Helper
  | Launchd
  | Hosts
  | FileSystem.FileSystem
  | CommandExecutor.CommandExecutor
  | DateTime.CurrentTimeZone
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
        const installed = yield* launchd.isInstalled();
        if (!installed) {
          yield* launchd.install(
            collectorPlist({
              node: process.execPath,
              entry: entryPath,
              databasePath,
              helperPath,
              logPath,
            }),
          );
          yield* prompt.print(`launchd agent: written ${plistPath}`);
        } else {
          yield* launchd.bootstrap();
        }
        yield* walkPermissions();
        const selected =
          hosts !== undefined
            ? hosts
            : (yield* prompt.interactive)
              ? yield* pickHosts
              : [];
        if (selected.length === 0) {
          yield* printManualCommands;
        } else {
          yield* registerHosts(selected);
        }
      }),
    );
  });
