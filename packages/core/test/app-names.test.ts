import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import { iosAppNames, resolveAppName } from "../src/index.js";

describe("iosAppNames", () => {
  it("the map holds at least 50 apps", () => {
    // Given: iosAppNames
    // When
    const count = Object.keys(iosAppNames).length;
    // Then
    expect(count).toBeGreaterThanOrEqual(50);
  });
});

describe("resolveAppName", () => {
  it("resolveAppName returns the built-in name and no genre", async () => {
    // Given: nothing
    // When
    const result = await Effect.runPromise(
      resolveAppName("com.apple.mobilesafari"),
    );
    // Then
    expect(result).toEqual(Option.some({ name: "Safari", genre: null }));
  });

  it("resolveAppName returns none for an unmapped id", async () => {
    // Given: nothing
    // When
    const result = await Effect.runPromise(
      resolveAppName("com.example.notanapp"),
    );
    // Then
    expect(result).toEqual(Option.none());
  });
});
