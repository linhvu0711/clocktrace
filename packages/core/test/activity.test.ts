import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { NewActivity } from "../src/index.js";

const input = {
  deviceId: "00000000-0000-4000-8000-000000000000",
  bundleId: "com.apple.Terminal",
  appName: "Terminal",
  title: null,
  url: null,
  startedAt: "2026-09-17T10:30:00.000Z",
  endedAt: "2026-09-17T10:00:00.000Z",
};

describe("activity", () => {
  it("rejects endedAt before startedAt naming endedAt", () => {
    // Given: endedAt earlier than startedAt
    // When
    const result = Schema.decodeUnknownEither(NewActivity)(input);
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ParseError");
      expect(result.left.message).toContain('["endedAt"]');
      expect(result.left.message).toContain("endedAt is before startedAt");
    }
  });

  it("accepts endedAt equal to startedAt", () => {
    // Given: endedAt equal to startedAt
    // When
    const result = Schema.decodeUnknownEither(NewActivity)({
      ...input,
      endedAt: "2026-09-17T10:30:00.000Z",
    });
    // Then
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.appName).toBe("Terminal");
    }
  });
});
