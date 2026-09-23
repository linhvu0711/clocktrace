import { homedir } from "node:os";

import { CollectorPaths, type LaunchdError } from "@clocktrace/collector";
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

// The cause is any tagged error whose message was already printed.
export class ReportedError extends Data.TaggedError("ReportedError")<{
  readonly cause: Error;
}> {}

// One ✘ line with the error's message, then a ReportedError so main.ts
// does not print it again. reportLaunchd stays for the launchctl steps:
// those add the log line.
export const reportStep = <A, E extends Error, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, ReportedError, R | Prompt | Style> =>
  Effect.catchAll(effect, (e) =>
    Effect.gen(function* () {
      const prompt = yield* Prompt;
      const look = yield* Style;
      yield* prompt.printError(
        line([mark("bad", look), ` ${e.message}`], look),
      );
      return yield* new ReportedError({ cause: e });
    }),
  );

export const reportLaunchd = <A, R>(
  effect: Effect.Effect<A, LaunchdError, R>,
): Effect.Effect<A, ReportedError, R | Prompt | Style | CollectorPaths> =>
  Effect.catchTag(effect, "LaunchdError", (e) =>
    Effect.gen(function* () {
      const prompt = yield* Prompt;
      const look = yield* Style;
      const { logPath } = yield* CollectorPaths;
      yield* prompt.printError(
        line([mark("bad", look), ` ${e.step}: ${e.detail}`], look),
      );
      yield* prompt.printError(
        line(["  log  ", span("dim", shortPath(logPath, homedir()))], look),
      );
      return yield* new ReportedError({ cause: e });
    }),
  );
