import { homedir } from "node:os";

import { type LaunchdError, logPath } from "@clocktrace/collector";
import { Options } from "@effect/cli";
import { Data, Effect } from "effect";

import { line, mark, Style, shortPath, span } from "./format.js";
import { Prompt } from "./prompt.js";

export const jsonOption = Options.boolean("json").pipe(
  Options.withDescription(
    "print JSON for scripts, the same shape the MCP tool returns",
  ),
);

export const report = <A extends Record<string, unknown>>(
  json: boolean,
  value: A,
  lines: (value: A) => ReadonlyArray<string>,
): Effect.Effect<void, never, Prompt> =>
  Effect.flatMap(Prompt, (prompt) =>
    Effect.forEach(json ? [JSON.stringify(value)] : lines(value), prompt.print),
  );

export class ReportedError extends Data.TaggedError("ReportedError")<{
  readonly cause: LaunchdError;
}> {}

export const reportLaunchd = <A, R>(
  effect: Effect.Effect<A, LaunchdError, R>,
): Effect.Effect<A, ReportedError, R | Prompt | Style> =>
  Effect.catchTag(effect, "LaunchdError", (e) =>
    Effect.gen(function* () {
      const prompt = yield* Prompt;
      const look = yield* Style;
      yield* prompt.print(
        line([mark("bad", look), ` ${e.step}: ${e.detail}`], look),
      );
      yield* prompt.print(
        line(["  log  ", span("dim", shortPath(logPath, homedir()))], look),
      );
      return yield* new ReportedError({ cause: e });
    }),
  );
