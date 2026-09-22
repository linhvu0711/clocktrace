import { Options } from "@effect/cli";
import { Effect } from "effect";

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
