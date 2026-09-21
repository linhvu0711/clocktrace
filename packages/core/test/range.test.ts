import { DateTime, Effect, Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { InvalidRangeError } from "../src/index.js";
import { Range, resolveRange } from "../src/index.js";

const friday = DateTime.unsafeMakeZoned("2026-09-18T17:00:00Z", {
  timeZone: "America/Los_Angeles",
});

const iso = (r: {
  readonly from: DateTime.Utc;
  readonly to: DateTime.Utc;
}) => ({
  from: DateTime.formatIso(r.from),
  to: DateTime.formatIso(r.to),
});

const expectInvalid = (
  result: Either.Either<
    { readonly from: DateTime.Utc; readonly to: DateTime.Utc },
    InvalidRangeError
  >,
  message: string,
) => {
  expect(Either.isLeft(result)).toBe(true);
  if (Either.isLeft(result)) {
    expect(result.left._tag).toBe("InvalidRangeError");
    expect(result.left.field).toBe("range");
    expect(result.left.message).toBe(message);
  }
};

describe("range", () => {
  it("a string range fails to decode, a struct decodes", () => {
    // Given: the old keyword form and the new struct form
    // When
    const asString = Schema.decodeUnknownEither(Range)("today");
    const asStruct = Schema.decodeUnknownEither(Range)({
      from: "2026-09-18",
      to: "2026-09-18",
    });
    // Then: a string is no longer a Range
    expect(Either.isLeft(asString)).toBe(true);
    expect(Either.isRight(asStruct)).toBe(true);
  });

  it("accepts a date-time from and to, to exclusive at that time", () => {
    // Given: Friday 10:00 PDT; "9am the 20th to 10am the 21st"
    // When
    const result = Effect.runSync(
      resolveRange(
        { from: "2026-09-20T09:00", to: "2026-09-21T10:00" },
        friday,
      ),
    );
    // Then: local wall clock reads in PDT (UTC-7), to lands on the instant
    expect(iso(result)).toEqual({
      from: "2026-09-20T16:00:00.000Z",
      to: "2026-09-21T17:00:00.000Z",
    });
  });

  it("a timed from with a bare to spans to the next midnight", () => {
    // Given: the Friday now
    // When
    const result = Effect.runSync(
      resolveRange({ from: "2026-09-18T14:30", to: "2026-09-18" }, friday),
    );
    // Then: from is the exact time, to is the whole of the 18th
    expect(iso(result)).toEqual({
      from: "2026-09-18T21:30:00.000Z",
      to: "2026-09-19T07:00:00.000Z",
    });
  });

  it("a one-day range is from midnight to the next midnight", () => {
    // Given: the Friday now
    // When
    const result = Effect.runSync(
      resolveRange({ from: "2026-09-18", to: "2026-09-18" }, friday),
    );
    // Then: a bare date is midnight, a bare to is the whole day
    expect(iso(result)).toEqual({
      from: "2026-09-18T07:00:00.000Z",
      to: "2026-09-19T07:00:00.000Z",
    });
  });

  it("a date range crosses a DST change as calendar days", () => {
    // Given: the Friday now; DST ends in Los Angeles on 2026-11-01
    // When
    const result = Effect.runSync(
      resolveRange({ from: "2026-10-31", to: "2026-11-01" }, friday),
    );
    // Then: 49 hours, the bare to is the whole day and the second has 25 hours
    expect(iso(result)).toEqual({
      from: "2026-10-31T07:00:00.000Z",
      to: "2026-11-02T08:00:00.000Z",
    });
  });

  it("fails naming range when from is after to", () => {
    // Given: the Friday now
    // When
    const result = Effect.runSync(
      Effect.either(
        resolveRange({ from: "2026-09-08", to: "2026-09-01" }, friday),
      ),
    );
    // Then
    expectInvalid(result, "range: from 2026-09-08 is after to 2026-09-01");
  });

  it("fails naming range and the bad value on a non-date", () => {
    // Given: the Friday now; 2026-02-30 never exists and T25:00 is no hour
    // When
    const loose = Effect.runSync(
      Effect.either(
        resolveRange({ from: "2026-9-1", to: "2026-09-08" }, friday),
      ),
    );
    const feb30 = Effect.runSync(
      Effect.either(
        resolveRange({ from: "2026-02-30", to: "2026-03-01" }, friday),
      ),
    );
    const badHour = Effect.runSync(
      Effect.either(
        resolveRange({ from: "2026-09-18T25:00", to: "2026-09-19" }, friday),
      ),
    );
    // Then: each names range and the bad value, none slides into a real date
    expectInvalid(
      loose,
      'range: from "2026-9-1" is not YYYY-MM-DD or YYYY-MM-DDTHH:mm',
    );
    expectInvalid(
      feb30,
      'range: from "2026-02-30" is not YYYY-MM-DD or YYYY-MM-DDTHH:mm',
    );
    expectInvalid(
      badHour,
      'range: from "2026-09-18T25:00" is not YYYY-MM-DD or YYYY-MM-DDTHH:mm',
    );
  });
});
