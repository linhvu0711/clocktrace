import { DateTime, Effect, Either } from "effect";
import { describe, expect, it } from "vitest";

import type { InvalidRangeError } from "../src/index.js";
import { resolveRange } from "../src/index.js";

const friday = DateTime.unsafeMakeZoned("2026-09-18T17:00:00Z", {
  timeZone: "America/Los_Angeles",
});

const iso = (r: { readonly from: DateTime.Utc; readonly to: DateTime.Utc }) => ({
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
  it("today and yesterday are local days in the pinned zone", () => {
    // Given: Friday 2026-09-18 10:00 PDT, already 17:00 UTC
    // When
    const today = Effect.runSync(resolveRange("today", friday));
    const yesterday = Effect.runSync(resolveRange("yesterday", friday));
    // Then: the day edges land at 07:00 UTC, not 00:00 UTC
    expect(iso(today)).toEqual({
      from: "2026-09-18T07:00:00.000Z",
      to: "2026-09-19T07:00:00.000Z",
    });
    expect(iso(yesterday)).toEqual({
      from: "2026-09-17T07:00:00.000Z",
      to: "2026-09-18T07:00:00.000Z",
    });
  });

  it("this week starts Monday and last week is the seven days before", () => {
    // Given: the same Friday
    // When
    const thisWeek = Effect.runSync(resolveRange("this week", friday));
    const lastWeek = Effect.runSync(resolveRange("last week", friday));
    // Then
    expect(iso(thisWeek)).toEqual({
      from: "2026-09-14T07:00:00.000Z",
      to: "2026-09-21T07:00:00.000Z",
    });
    expect(iso(lastWeek)).toEqual({
      from: "2026-09-07T07:00:00.000Z",
      to: "2026-09-14T07:00:00.000Z",
    });
  });

  it("Sunday night local is still this week", () => {
    // Given: Sunday 2026-09-20 23:30 PDT, already Monday in UTC
    const now = DateTime.unsafeMakeZoned("2026-09-21T06:30:00Z", {
      timeZone: "America/Los_Angeles",
    });
    // When
    const today = Effect.runSync(resolveRange("today", now));
    const thisWeek = Effect.runSync(resolveRange("this week", now));
    // Then
    expect(iso(today)).toEqual({
      from: "2026-09-20T07:00:00.000Z",
      to: "2026-09-21T07:00:00.000Z",
    });
    expect(iso(thisWeek)).toEqual({
      from: "2026-09-14T07:00:00.000Z",
      to: "2026-09-21T07:00:00.000Z",
    });
  });

  it("Monday just after midnight starts a new week", () => {
    // Given: Monday 2026-09-14 00:30 PDT
    const now = DateTime.unsafeMakeZoned("2026-09-14T07:30:00Z", {
      timeZone: "America/Los_Angeles",
    });
    // When
    const thisWeek = Effect.runSync(resolveRange("this week", now));
    const lastWeek = Effect.runSync(resolveRange("last week", now));
    // Then
    expect(iso(thisWeek)).toEqual({
      from: "2026-09-14T07:00:00.000Z",
      to: "2026-09-21T07:00:00.000Z",
    });
    expect(iso(lastWeek)).toEqual({
      from: "2026-09-07T07:00:00.000Z",
      to: "2026-09-14T07:00:00.000Z",
    });
  });

  it("a date range crosses a DST change as calendar days", () => {
    // Given: the Friday now; DST ends in Los Angeles on 2026-11-01
    // When
    const result = Effect.runSync(
      resolveRange({ from: "2026-10-31", to: "2026-11-01" }, friday),
    );
    // Then: 49 hours, to is inclusive and the second day has 25 hours
    expect(iso(result)).toEqual({
      from: "2026-10-31T07:00:00.000Z",
      to: "2026-11-02T08:00:00.000Z",
    });
  });

  it("a one-day range is from midnight to the next midnight", () => {
    // Given: the Friday now
    // When
    const result = Effect.runSync(
      resolveRange({ from: "2026-09-18", to: "2026-09-18" }, friday),
    );
    // Then
    expect(iso(result)).toEqual({
      from: "2026-09-18T07:00:00.000Z",
      to: "2026-09-19T07:00:00.000Z",
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

  it("fails naming range on an unknown keyword", () => {
    // Given: the Friday now
    // When
    const result = Effect.runSync(
      Effect.either(resolveRange("last month", friday)),
    );
    // Then
    expectInvalid(result, 'range: unknown keyword "last month"');
  });

  it("fails naming range when a date is not YYYY-MM-DD", () => {
    // Given: the Friday now
    // When
    const result = Effect.runSync(
      Effect.either(
        resolveRange({ from: "2026-9-1", to: "2026-09-08" }, friday),
      ),
    );
    // Then
    expectInvalid(result, "range: from and to must be YYYY-MM-DD");
  });
});
