import { Launchd } from "@clocktrace/collector";
import { Command } from "@effect/cli";
import type { FileSystem } from "@effect/platform";
import { Effect } from "effect";

import { line, mark, Style } from "./format.js";
import { type ReportedError, reportLaunchd } from "./output.js";
import { Prompt } from "./prompt.js";
import { type NotSetUpError, requireSetUp } from "./set-up.js";

export const start = (): Effect.Effect<
  void,
  NotSetUpError | ReportedError,
  Prompt | Launchd | FileSystem.FileSystem | Style
> =>
  requireSetUp.pipe(
    Effect.andThen(
      Effect.gen(function* () {
        const launchd = yield* Launchd;
        const prompt = yield* Prompt;
        const look = yield* Style;
        yield* reportLaunchd(launchd.bootstrap());
        yield* prompt.print(
          line([mark("ok", look), " collector running"], look),
        );
      }),
    ),
  );

export const startCommand = Command.make("start", {}, () => start()).pipe(
  Command.withDescription("start the collector"),
);
