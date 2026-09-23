import { DateTime, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppStore,
  activities,
  openStore,
  Store,
  summary,
} from "../src/index.js";
import { seedMany, seedTwoDevices } from "../src/testing.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const run = <A, E>(
  effect: Effect.Effect<A, E, Store | AppStore | DateTime.CurrentTimeZone>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      Effect.provide(Layer.merge(EmptyStore, AppStore.Test)),
    ),
  );

const day = { from: "2026-09-18", to: "2026-09-18" };

describe("testing", () => {
  it("seedDay, seedTwoDevices, and seedMany store the shared test day", async () => {
    // Given: one store with seedTwoDevices, which holds seedDay, and one with seedMany
    const twoDevices = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedTwoDevices(store);
        // When
        return yield* summary({ range: day, groupBy: "app" });
      }),
    );
    const many = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 3);
        // When
        return yield* activities({ range: day });
      }),
    );
    // Then
    expect({ rows: twoDevices.rows, total: many.total }).toEqual({
      rows: [
        { key: "com.microsoft.VSCode", name: "Code", seconds: 5400 },
        { key: "com.google.Chrome", name: "Google Chrome", seconds: 600 },
        { key: "com.apple.Safari", name: "Safari", seconds: 300 },
      ],
      total: 3,
    });
  });
});
