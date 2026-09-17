import { Either, Schema } from "effect";
import { describe, expect, it } from "vitest";

import { NewDevice } from "../src/index.js";

describe("device", () => {
  it("rejects an unknown kind naming kind", () => {
    // Given: a kind outside the documented set
    const input = { kind: "watch", name: "Watch", externalId: "w-1" };
    // When
    const result = Schema.decodeUnknownEither(NewDevice)(input);
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("ParseError");
      expect(result.left.message).toContain('["kind"]');
      expect(result.left.message).toContain('Expected "mac"');
      expect(result.left.message).toContain('actual "watch"');
    }
  });
});
