import {
  type AppStore,
  emptyNote,
  type InvalidRangeError,
  type Store,
  type StoreError,
  TimelineBlock,
  type TimelineInput,
  timeline,
  usedRange,
} from "@clocktrace/core";
import { Command } from "@effect/cli";
import { DateTime, Effect, Option, Schema } from "effect";
import type { ParseError } from "effect/ParseResult";

import {
  type Cell,
  columns,
  duration,
  type Look,
  line,
  Style,
  shortDuration,
  span,
} from "./format.js";
import { jsonOption, report } from "./output.js";
import type { Prompt } from "./prompt.js";
import { whenSetUp } from "./set-up.js";
import {
  deviceOption,
  fromOption,
  localMinute,
  requireWindow,
  toOption,
  windowLine,
} from "./window.js";

export const timelineScreen = (
  blocks: ReadonlyArray<TimelineBlock>,
  zone: DateTime.TimeZone,
  look: Look,
): ReadonlyArray<string> => {
  const secondsOf = (block: TimelineBlock) =>
    Math.round((block.end.epochMillis - block.start.epochMillis) / 1000);
  const widest = Math.max(
    ...blocks.map((block) => shortDuration(secondsOf(block)).length),
  );
  const rows = columns(
    blocks.map(
      (block): ReadonlyArray<Cell> => [
        `  ${localMinute(block.start, zone).slice(11)}`,
        shortDuration(secondsOf(block)).padStart(widest),
        block.app,
        block.categoryName,
        block.projectName ?? span("dim", "—"),
      ],
    ),
    look,
  );
  const totalSeconds = Math.round(
    blocks.reduce(
      (sum, block) => sum + block.end.epochMillis - block.start.epochMillis,
      0,
    ) / 1000,
  );
  return [
    ...rows,
    line(
      [
        "  ",
        span(
          "dim",
          `${blocks.length} ${blocks.length === 1 ? "block" : "blocks"} · ${duration(totalSeconds)}`,
        ),
      ],
      look,
    ),
  ];
};

export const printTimeline = (
  input: TimelineInput,
  json: boolean,
): Effect.Effect<
  void,
  InvalidRangeError | StoreError | ParseError,
  Store | AppStore | Prompt | DateTime.CurrentTimeZone | Style
> =>
  Effect.gen(function* () {
    const look = yield* Style;
    const zone = yield* DateTime.CurrentTimeZone;
    const range = yield* usedRange(input.range);
    const blocks = yield* timeline(input);
    const rows = yield* Schema.encode(Schema.Array(TimelineBlock))(blocks);
    const lines = timelineScreen(blocks, zone, look);
    const value = { range, rows, total: rows.length, ...emptyNote(rows) };
    yield* report(json, value, (v) =>
      v.note === undefined
        ? [windowLine(input.range, v.range.zone, look), ...lines]
        : [windowLine(input.range, v.range.zone, look), "no activity"],
    );
  });

export const timelineCommand = Command.make(
  "timeline",
  {
    from: fromOption,
    to: toOption,
    device: deviceOption,
    json: jsonOption,
  },
  ({ from, to, device, json }) =>
    Effect.gen(function* () {
      const range = yield* requireWindow("timeline", from, to);
      return yield* whenSetUp(
        printTimeline({ range, deviceId: Option.getOrUndefined(device) }, json),
      );
    }),
).pipe(Command.withDescription("show a timeline of activity blocks"));
