import { Launchd, type LaunchdError } from "@clocktrace/collector";
import { Command } from "@effect/cli";
import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { Prompt } from "./prompt.js";
import { type NotSetUpError, requireSetUp } from "./set-up.js";

export const start = (): Effect.Effect<
  void,
  NotSetUpError | LaunchdError,
  Prompt | Launchd | FileSystem.FileSystem
> =>
  requireSetUp.pipe(
    Effect.andThen(
      Effect.gen(function* () {
        const launchd = yield* Launchd;
        const prompt = yield* Prompt;
        yield* launchd.bootstrap();
        yield* prompt.print("collector: running");
      }),
    ),
  );

export const startCommand = Command.make("start", {}, () => start());
