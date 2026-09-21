import {
  type Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  type Launchd,
  type LaunchdError,
  readStatus,
  Status,
  statusLines,
} from "@clocktrace/collector";
import type { Store, StoreError } from "@clocktrace/core";
import { Command } from "@effect/cli";
import type { FileSystem } from "@effect/platform";
import { type DateTime, Effect, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { type NotSetUpError, requireSetUp, withStore } from "./set-up.js";

export const printStatus = (
  json = false,
): Effect.Effect<
  void,
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | LaunchdError,
  Prompt | Launchd | Helper | Store | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const status = yield* readStatus();
    const lines = yield* statusLines(status);
    const encoded = yield* Schema.encode(Status)(status);
    yield* report(
      json,
      { ...encoded, imports: "not built yet" as const, lines },
      () => lines,
    );
  });

export const status = (
  json = false,
): Effect.Effect<
  void,
  | NotSetUpError
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | import("@clocktrace/core").DatabaseNewerError
  | LaunchdError,
  Prompt | Launchd | Helper | FileSystem.FileSystem | DateTime.CurrentTimeZone
> => requireSetUp.pipe(Effect.andThen(withStore(printStatus(json))));

export const statusCommand = Command.make(
  "status",
  { json: jsonOption },
  ({ json }) => status(json),
);
