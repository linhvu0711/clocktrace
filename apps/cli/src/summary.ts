import {
  emptyNote,
  GroupBy,
  type InvalidRangeError,
  type Store,
  type StoreError,
  Summary,
  type SummaryInput,
  type SummaryRow,
  summary,
  usedRange,
} from "@clocktrace/core";
import { Command, Options } from "@effect/cli";
import { type DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";
import { deviceOption, fromOption, toOption, windowLine } from "./window.js";

export const summaryLine = (row: SummaryRow): string =>
  [
    row.key,
    row.name,
    String(row.seconds),
    ...(row.productive === undefined
      ? []
      : [row.productive ? "productive" : "not productive"]),
  ].join("  ");

export const printSummary = (
  input: SummaryInput,
  json: boolean,
): Effect.Effect<
  void,
  InvalidRangeError | StoreError | ParseError,
  Store | Prompt | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const range = yield* usedRange(input.range);
    const result = yield* summary(input);
    const encoded = yield* Schema.encode(Summary)(result);
    const value = { range, ...encoded, ...emptyNote(encoded.rows) };
    yield* report(json, value, (v) =>
      v.note === undefined
        ? [windowLine(v.range), ...v.rows.map(summaryLine), `total  ${v.total}`]
        : [windowLine(v.range), v.note],
    );
  });

const groupBy = Options.choice("group-by", GroupBy.literals).pipe(
  Options.withDefault("category"),
  Options.withDescription("category, project, app, or device"),
);

export const summaryCommand = Command.make(
  "summary",
  {
    from: fromOption,
    to: toOption,
    groupBy,
    device: deviceOption,
    json: jsonOption,
  },
  ({ from, to, groupBy, device, json }) =>
    whenSetUp(
      printSummary(
        {
          range: { from, to },
          groupBy,
          deviceId: Option.getOrUndefined(device),
        },
        json,
      ),
    ),
);
