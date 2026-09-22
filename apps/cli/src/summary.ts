import {
  type AppStore,
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

import {
  type Cell,
  columns,
  duration,
  type Look,
  type Span,
  Style,
  span,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";
import {
  deviceOption,
  fromOption,
  requireWindow,
  toOption,
  windowLine,
} from "./window.js";

export const summaryScreen = (
  rows: ReadonlyArray<SummaryRow>,
  total: number,
  look: Look,
): ReadonlyArray<string> => {
  const widest = Math.max(
    duration(total).length,
    ...rows.map((r) => duration(r.seconds).length),
  );
  const bar = (share: number): ReadonlyArray<string | Span> => {
    const filled = Math.round(share * 20);
    return look.unicode
      ? ["█".repeat(filled), span("dim", "░".repeat(20 - filled))]
      : ["#".repeat(filled), span("dim", ".".repeat(20 - filled))];
  };
  const rowCells = (row: SummaryRow): ReadonlyArray<Cell> => {
    const share = total === 0 ? 0 : row.seconds / total;
    const cells: ReadonlyArray<Cell> = [
      `  ${row.name}`,
      duration(row.seconds).padStart(widest),
      bar(share),
      `${Math.round(share * 100)}%`.padStart(4),
    ];
    return row.productive === undefined
      ? cells
      : [
          ...cells,
          row.productive
            ? span("ok", "productive")
            : span("dim", "not productive"),
        ];
  };
  return columns(
    [
      ...rows.map(rowCells),
      [span("head", "  total"), duration(total).padStart(widest)],
    ],
    look,
  );
};

export const printSummary = (
  input: SummaryInput,
  json: boolean,
): Effect.Effect<
  void,
  InvalidRangeError | StoreError | ParseError,
  Store | AppStore | Prompt | DateTime.CurrentTimeZone | Style
> =>
  Effect.gen(function* () {
    const look = yield* Style;
    const range = yield* usedRange(input.range);
    const result = yield* summary(input);
    const encoded = yield* Schema.encode(Summary)(result);
    const value = { range, ...encoded, ...emptyNote(encoded.rows) };
    yield* report(json, value, (v) =>
      v.note === undefined
        ? [
            windowLine(input.range, v.range.zone, look, `by ${input.groupBy}`),
            ...summaryScreen(v.rows, v.total, look),
          ]
        : [
            windowLine(input.range, v.range.zone, look, `by ${input.groupBy}`),
            "no activity",
          ],
    );
  });

const groupBy = Options.choice("group-by", GroupBy.literals).pipe(
  Options.withDefault("category"),
  Options.withDescription("how to group the rows"),
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
    Effect.gen(function* () {
      const range = yield* requireWindow("summary", from, to);
      return yield* whenSetUp(
        printSummary(
          { range, groupBy, deviceId: Option.getOrUndefined(device) },
          json,
        ),
      );
    }),
).pipe(
  Command.withDescription(
    "show time summed by category, project, app, or device",
  ),
);
