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
import { type DateTime, Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import { walkPermissions } from "./permissions.js";
import { Prompt } from "./prompt.js";
import { withStore } from "./set-up.js";

export const setup = (): Effect.Effect<
  void,
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | DatabaseNewerError
  | LaunchdError,
  Prompt | Helper | Launchd | DateTime.CurrentTimeZone
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
        }
        yield* walkPermissions();
        yield* prompt.print("next: register with your AI app");
      }),
    );
  });
