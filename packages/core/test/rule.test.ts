import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { NewRule } from "../src/index.js";

const input = {
  position: 0,
  field: "colour",
  compare: "is",
  value: "x",
  effect: "category",
  target: "c1",
};

describe("rule", () => {
  it("rejects an unknown field naming field", () => {
    // Given: a field outside the documented set
    // When
    const result = Schema.decodeUnknownEither(NewRule)(input);
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ParseError");
      expect(result.left.message).toContain('["field"]');
      expect(result.left.message).toContain('actual "colour"');
    }
  });

  it("rejects an unknown compare naming compare", () => {
    // Given: a compare outside the documented set
    // When
    const result = Schema.decodeUnknownEither(NewRule)({
      ...input,
      field: "app",
      compare: "like",
    });
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain('["compare"]');
      expect(result.left.message).toContain('actual "like"');
    }
  });

  it("rejects an unknown effect naming effect", () => {
    // Given: an effect outside the documented set
    // When
    const result = Schema.decodeUnknownEither(NewRule)({
      ...input,
      field: "app",
      effect: "hide",
    });
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left.message).toContain('["effect"]');
      expect(result.left.message).toContain('actual "hide"');
    }
  });

  it("accepts every documented field, compare, and effect", () => {
    // Given: a rule inside the documented sets
    // When
    const result = Schema.decodeUnknownEither(NewRule)({
      position: 3,
      field: "domain",
      compare: "matches",
      value: "^github\\.com$",
      effect: "project",
      target: "p1",
    });
    // Then
    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.compare).toBe("matches");
    }
  });
});
