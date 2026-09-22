import {
  App,
  AppMissingError,
  appPath,
  browserName,
  Helper,
  type HelperExitedError,
  type Launchd,
  type LaunchdError,
  type PermissionItem,
  permissionItems,
  type RequestOutcome,
} from "@clocktrace/collector";
import type { DatabaseNewerError, Store, StoreError } from "@clocktrace/core";
import { Command } from "@effect/cli";
import type { FileSystem, Path, Terminal } from "@effect/platform";
import { type DateTime, Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import type { Style } from "./format.js";
import { Prompt, type Stdin, type StoppedError } from "./prompt.js";
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
    return "full disk access: System Settings opened, turn it on for Clocktrace";
  }
  return `${item.name}: asked, answer the macOS prompt`;
};

export const walkPermissions = (): Effect.Effect<
  void,
  | AppMissingError
  | HelperExitedError
  | ParseError
  | StoreError
  | LaunchdError
  | StoppedError,
  | Prompt
  | Stdin
  | Helper
  | App
  | Launchd
  | Store
  | DateTime.CurrentTimeZone
  | Terminal.Terminal
  | FileSystem.FileSystem
  | Path.Path
  | Style
> =>
  Effect.gen(function* () {
    const prompt = yield* Prompt;
    const helper = yield* Helper;
    const app = yield* App;
    if (!(yield* app.isInstalled())) {
      yield* new AppMissingError({ path: appPath });
      return;
    }
    const interactive = yield* prompt.interactive;
    const p = yield* Effect.scoped(helper.permissions(appPath));
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
      const outcome = yield* Effect.scoped(
        helper.request(appPath, item.request),
      );
      yield* prompt.print(outcomeLine(item, outcome));
    }
    yield* printStatus();
  });

export const permissions = (): Effect.Effect<
  void,
  | NotSetUpError
  | AppMissingError
  | HelperExitedError
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
  | FileSystem.FileSystem
  | Terminal.Terminal
  | Path.Path
  | DateTime.CurrentTimeZone
  | Style
> => requireSetUp.pipe(Effect.andThen(withStore(walkPermissions())));

export const permissionsCommand = Command.make("permissions", {}, () =>
  permissions(),
).pipe(
  Command.withDescription("check the macOS permissions the collector needs"),
);
