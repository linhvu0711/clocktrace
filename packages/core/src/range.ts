import { DateTime, Effect, Option, Schema } from "effect";

import { InvalidRangeError } from "./errors.js";

/**
 * A start and an end. Each is a local date `YYYY-MM-DD` or a local date-time
 * `YYYY-MM-DDTHH:mm`, read in the current zone; a bare date means midnight.
 * `to` is exclusive when it carries a time, and a bare `to` date means the
 * whole of that day, so `{ from: "2026-09-18", to: "2026-09-18" }` is one day.
 */
export const Range = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
});

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const pad = (n: number): string => String(n).padStart(2, "0");

const isoDay = (zoned: DateTime.Zoned): string => {
  const parts = DateTime.toParts(zoned);
  const year = String(parts.year).padStart(4, "0");
  return `${year}-${pad(parts.month)}-${pad(parts.day)}`;
};

const isoMinute = (zoned: DateTime.Zoned): string =>
  `${isoDay(zoned)}T${pad(DateTime.toParts(zoned).hours)}:${pad(
    DateTime.toParts(zoned).minutes,
  )}`;

interface Parsed {
  readonly zoned: DateTime.Zoned;
  readonly hasTime: boolean;
}

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
    // A wall clock the calendar does not hold, like 2026-02-30 or T25:00,
    // must fail: parsing would slide it. The round trip catches it.
    const parse = (text: string): Option.Option<Parsed> => {
      const hasTime = dateTimePattern.test(text);
      if (!hasTime && !dayPattern.test(text)) {
        return Option.none<Parsed>();
      }
      return Option.map(
        Option.filter(
          DateTime.makeZoned(text, {
            timeZone: now.zone,
            adjustForTimeZone: true,
          }),
          (zoned) => (hasTime ? isoMinute(zoned) : isoDay(zoned)) === text,
        ),
        (zoned) => ({ zoned, hasTime }),
      );
    };
    const notADate = (label: "from" | "to", value: string) =>
      `${label} "${value}" is not YYYY-MM-DD or YYYY-MM-DDTHH:mm`;
    const from = parse(range.from);
    if (Option.isNone(from)) {
      return yield* fail(notADate("from", range.from));
    }
    const to = parse(range.to);
    if (Option.isNone(to)) {
      return yield* fail(notADate("to", range.to));
    }
    const fromUtc = DateTime.toUtc(from.value.zoned);
    // A bare `to` date covers the whole day, so it ends at the next midnight;
    // a `to` with a time is exclusive at that instant.
    const toUtc = to.value.hasTime
      ? DateTime.toUtc(to.value.zoned)
      : DateTime.toUtc(DateTime.add(to.value.zoned, { days: 1 }));
    if (fromUtc.epochMillis > toUtc.epochMillis) {
      return yield* fail(`from ${range.from} is after to ${range.to}`);
    }
    return { from: fromUtc, to: toUtc };
  });

export type Range = Schema.Schema.Type<typeof Range>;
