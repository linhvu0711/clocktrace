import {
  browserName,
  Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  helperPathConfig,
  type Launchd,
  type LaunchdError,
  type PermissionItem,
  permissionItems,
  type RequestOutcome,
} from "@clocktrace/collector";
import type { DatabaseNewerError, Store, StoreError } from "@clocktrace/core";
import type { FileSystem } from "@effect/platform";
import { type DateTime, Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import { Prompt } from "./prompt.js";
import { type NotSetUpError, requireSetUp, withStore } from "./set-up.js";
import { printStatus } from "./status.js";

const outcomeLine = (item: PermissionItem, outcome: RequestOutcome): string => {
  if (outcome === "notRunning") {
    const browser =
      item.request.kind === "automation"
        ? browserName(item.request.bundleId)
        : item.name;
    return `${item.name}: ${browser} is not running, open it and retry`;
  }
  if (item.request.kind === "fullDiskAccess") {
    return "full disk access: System Settings opened, turn it on for clocktrace-helper";
  }
  return `${item.name}: asked, answer the macOS prompt`;
};

export const walkPermissions = (): Effect.Effect<
  void,
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | LaunchdError,
  Prompt | Helper | Launchd | Store | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const prompt = yield* Prompt;
    const helper = yield* Helper;
    const helperPath = yield* Effect.orDie(helperPathConfig);
    yield* helper.check(helperPath);
    const interactive = yield* prompt.interactive;
    const p = yield* helper.permissions(helperPath);
    for (const item of permissionItems(p)) {
      yield* prompt.print(`${item.name}: ${item.gives}`);
      yield* prompt.print(`  denied: ${item.loss}`);
      if (item.state === "granted") {
        yield* prompt.print(`${item.name}: granted`);
        continue;
      }
      const answer = interactive
        ? yield* prompt.ask("grant or skip? ")
        : "skip";
      if (answer.trim() !== "grant") {
        yield* prompt.print(`${item.name}: skipped, ${item.loss}`);
        continue;
      }
      const outcome = yield* helper.request(helperPath, item.request);
      yield* prompt.print(outcomeLine(item, outcome));
    }
    yield* printStatus();
  });

export const permissions = (): Effect.Effect<
  void,
  | NotSetUpError
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | DatabaseNewerError
  | LaunchdError,
  Prompt | Helper | Launchd | FileSystem.FileSystem | DateTime.CurrentTimeZone
> => requireSetUp.pipe(Effect.andThen(withStore(walkPermissions())));
