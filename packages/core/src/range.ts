import { DateTime, Effect, Option, Schema } from "effect";

import { InvalidRangeError } from "./errors.js";

/**
 * A keyword (`today`, `yesterday`, `this week`, `last week`) or two
 * `YYYY-MM-DD` dates in the current zone. Both dates are whole days and
 * `to` is inclusive: `{ from: "2026-09-18", to: "2026-09-18" }` is one day.
 */
export const Range = Schema.Union(
  Schema.String,
  Schema.Struct({ from: Schema.String, to: Schema.String }),
);

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, "0");

const isoDay = (zoned: DateTime.Zoned): string => {
  const parts = DateTime.toParts(zoned);
  const year = String(parts.year).padStart(4, "0");
  return `${year}-${pad(parts.month)}-${pad(parts.day)}`;
};

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
    // A day the calendar does not hold, like 2026-02-30, must fail: Date
    // parsing would slide it into March. The round trip catches it.
    const parse = (text: string) =>
      dayPattern.test(text)
        ? Option.filter(
            DateTime.makeZoned(text, {
              timeZone: now.zone,
              adjustForTimeZone: true,
            }),
            (zoned) => isoDay(zoned) === text,
          )
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
