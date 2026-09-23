import { Store } from "@clocktrace/core";
import { DateTime, Effect } from "effect";
import { describe, expect, it } from "vitest";

import { readSavedGrants } from "../src/saved-grant.js";

describe("saved-grant", () => {
  it("readSavedGrants returns a saved grant", async () => {
    // Given: a Saved grant for Safari in the settings table
    const grants = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting(
          "grant.com.apple.Safari",
          '{"state":"granted","checkedAt":"2026-09-23T20:20:00.000Z"}',
        );
        // When
        return yield* readSavedGrants();
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    const safari = grants.get("com.apple.Safari");
    expect(grants.size).toBe(1);
    expect(safari?.state).toBe("granted");
    expect(safari && DateTime.formatIso(safari.checkedAt)).toBe(
      "2026-09-23T20:20:00.000Z",
    );
  });

  it("a saved grant that does not decode counts as none", async () => {
    // Given: a Saved grant value that is not JSON
    const grants = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting("grant.com.apple.Safari", "not json");
        // When
        return yield* readSavedGrants();
      }).pipe(Effect.provide(Store.Test)),
    );
    // Then
    expect(grants.size).toBe(0);
  });
});
