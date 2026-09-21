import {
  type Helper,
  type HelperExitedError,
  type HelperNotFoundError,
  type Launchd,
  type LaunchdError,
  readStatus,
  statusLines,
} from "@clocktrace/collector";
import type { Store, StoreError } from "@clocktrace/core";
import type { FileSystem } from "@effect/platform";
import { type DateTime, Effect } from "effect";
import type { ParseError } from "effect/ParseResult";

import { Prompt } from "./prompt.js";
import { type NotSetUpError, requireSetUp, withStore } from "./set-up.js";

export const printStatus = (): Effect.Effect<
  void,
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | LaunchdError,
  Prompt | Launchd | Helper | Store | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const prompt = yield* Prompt;
    const status = yield* readStatus();
    const text = yield* statusLines(status);
    yield* Effect.forEach(text, prompt.print);
  });

export const status = (): Effect.Effect<
  void,
  | NotSetUpError
  | HelperNotFoundError
  | HelperExitedError
  | ParseError
  | StoreError
  | import("@clocktrace/core").DatabaseNewerError
  | LaunchdError,
  Prompt | Launchd | Helper | FileSystem.FileSystem | DateTime.CurrentTimeZone
> => requireSetUp.pipe(Effect.andThen(withStore(printStatus())));
