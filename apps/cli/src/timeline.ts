import {
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

export const blockLine = (
  block: TimelineBlock,
  zone: DateTime.TimeZone,
): string =>
  [
    localMinute(block.start, zone),
    localMinute(block.end, zone),
    block.app,
    block.categoryName,
    ...(block.projectName === null ? [] : [block.projectName]),
  ].join("  ");

export const printTimeline = (
  input: TimelineInput,
  json: boolean,
): Effect.Effect<
  void,
  InvalidRangeError | StoreError | ParseError,
  Store | Prompt | DateTime.CurrentTimeZone
> =>
  Effect.gen(function* () {
    const zone = yield* DateTime.CurrentTimeZone;
    const range = yield* usedRange(input.range);
    const blocks = yield* timeline(input);
    const rows = yield* Schema.encode(Schema.Array(TimelineBlock))(blocks);
    const lines = blocks.map((b) => blockLine(b, zone));
    const value = { range, rows, total: rows.length, ...emptyNote(rows) };
    yield* report(json, value, (v) =>
      v.note === undefined
        ? [windowLine(v.range), ...lines]
        : [windowLine(v.range), v.note],
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
