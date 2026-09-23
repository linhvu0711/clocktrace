import { Store, StoreError } from "@clocktrace/core";
import { DateTime, Effect, Layer, Logger, Option } from "effect";
import { describe, expect, it } from "vitest";

import { readSavedGrants, saveLiveGrants } from "../src/saved-grant.js";

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

  it("a failed Saved grant delete logs and the walk goes on", async () => {
    // Given: a Store whose deleteSetting fails; Chrome reads notAsked and
    // Safari reads granted
    const failingDelete = Layer.effect(
      Store,
      Effect.map(
        Store,
        (s) =>
          new Store({
            ...s,
            deleteSetting: () =>
              Effect.fail(new StoreError({ cause: "disk full" })),
          }),
      ),
    );
    const logs: Array<string> = [];
    const testLogger = Logger.replace(
      Logger.defaultLogger,
      Logger.make(({ message }) => {
        logs.push(String(message));
      }),
    );
    // When
    const safari = await Effect.runPromise(
      Effect.gen(function* () {
        yield* saveLiveGrants(
          {
            accessibility: "granted",
            automation: {
              "com.google.Chrome": "notAsked",
              "com.apple.Safari": "granted",
            },
            fullDiskAccess: "granted",
          },
          DateTime.unsafeMake("2026-09-23T20:20:00Z"),
        );
        const store = yield* Store;
        return yield* store.getSetting("grant.com.apple.Safari");
      }).pipe(
        Effect.provide(
          Layer.merge(Layer.provide(failingDelete, Store.Test), testLogger),
        ),
      ),
    );
    // Then
    expect(logs).toEqual(["saved grant not deleted"]);
    expect(Option.isSome(safari)).toBe(true);
  });
});
