import { DateTime, Effect, Option, Schema } from "effect";

import { InvalidRangeError } from "./errors.js";

export const Range = Schema.Union(
  Schema.String,
  Schema.Struct({ from: Schema.String, to: Schema.String }),
);

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

export const resolveRange = (
  range: Range,
  now: DateTime.Zoned,
): Effect.Effect<
  { readonly from: DateTime.Utc; readonly to: DateTime.Utc },
  InvalidRangeError
> =>
  Effect.gen(function* () {
    const fail = (reason: string) =>
      new InvalidRangeError({ field: "range", reason });
    if (typeof range === "string") {
      const dayStart = DateTime.startOf(now, "day");
      const weekStart = DateTime.startOf(now, "week", { weekStartsOn: 1 });
      switch (range) {
        case "today":
          return {
            from: DateTime.toUtc(dayStart),
            to: DateTime.toUtc(DateTime.add(dayStart, { days: 1 })),
          };
        case "yesterday":
          return {
            from: DateTime.toUtc(
              DateTime.startOf(DateTime.subtract(now, { days: 1 }), "day"),
            ),
            to: DateTime.toUtc(dayStart),
          };
        case "this week":
          return {
            from: DateTime.toUtc(weekStart),
            to: DateTime.toUtc(DateTime.add(weekStart, { weeks: 1 })),
          };
        case "last week":
          return {
            from: DateTime.toUtc(DateTime.subtract(weekStart, { weeks: 1 })),
            to: DateTime.toUtc(weekStart),
          };
        default:
          return yield* fail(`unknown keyword "${range}"`);
      }
    }
    const parse = (text: string) =>
      dayPattern.test(text)
        ? DateTime.makeZoned(text, {
            timeZone: now.zone,
            adjustForTimeZone: true,
          })
        : Option.none<DateTime.Zoned>();
    const from = parse(range.from);
    const to = parse(range.to);
    if (Option.isNone(from) || Option.isNone(to)) {
      return yield* fail("from and to must be YYYY-MM-DD");
    }
    const fromStart = DateTime.startOf(from.value, "day");
    const toStart = DateTime.startOf(to.value, "day");
    if (fromStart.epochMillis > toStart.epochMillis) {
      return yield* fail(`from ${range.from} is after to ${range.to}`);
    }
    return {
      from: DateTime.toUtc(fromStart),
      to: DateTime.toUtc(DateTime.add(toStart, { days: 1 })),
    };
  });

export type Range = Schema.Schema.Type<typeof Range>;
