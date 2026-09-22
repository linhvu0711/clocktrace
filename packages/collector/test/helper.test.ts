import { Either } from "effect";
import { describe, expect, it } from "vitest";

import { biomeResult, HelperExitedError, sinceArgs } from "../src/helper.js";

describe("HelperExitedError", () => {
  it("HelperExitedError names the cause", () => {
    // Given: a Helper that exited non-zero
    const error = new HelperExitedError({
      cause: "permissions request exited 3",
    });
    // When
    const message = error.message;
    // Then
    expect(message).toBe("helper exited: permissions request exited 3");
    expect(message.length).toBeGreaterThan(0);
  });

  it("biomeResult returns the lines on exit 0", () => {
    // Given: a biome command that printed two lines and a blank
    // When
    const result = biomeResult(0, ["a", "b", ""], "");
    // Then
    expect(Either.getOrThrow(result)).toEqual(["a", "b"]);
  });

  it("biomeResult names the exit code and stderr", () => {
    // Given: a biome command that exited 4 with a reason on stderr
    // When
    const result = biomeResult(4, [], "no App.InFocus remote folder\n");
    // Then
    expect(Either.isLeft(result)).toBe(true);
    if (Either.isLeft(result)) {
      expect(result.left._tag).toBe("BiomeExitError");
      expect(result.left.message).toBe(
        "helper biome exited 4: no App.InFocus remote folder",
      );
    }
  });

  it("sinceArgs writes one --since per Device", () => {
    // Given: Progress for two devices, one with a fractional ts
    const map = new Map([
      ["b-device", 200.7],
      ["a-device", 150],
    ]);
    // When
    const args = sinceArgs(map);
    // Then
    expect(args).toEqual([
      "--since",
      "a-device=150",
      "--since",
      "b-device=200",
    ]);
  });

  it("sinceArgs is empty without Progress", () => {
    // Given: no Progress
    // When
    const args = sinceArgs(new Map());
    // Then
    expect(args).toEqual([]);
  });
});
