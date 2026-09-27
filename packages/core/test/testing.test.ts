import { DateTime, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppStore,
  activities,
  openStore,
  Store,
  summary,
} from "../src/index.js";
import { seedBreakdown, seedMany, seedTwoDevices } from "../src/testing.js";

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

  it("seedBreakdown stores three Devices and 50 Activities", async () => {
    // Given: an empty store
    const { total, names } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        // When
        yield* seedBreakdown(store);
        const { total } = yield* activities({ range: day });
        const devices = yield* store.listDevices();
        return { total, names: devices.map((d) => d.name).sort() };
      }),
    );
    // Then
    expect({ total, names }).toEqual({
      total: 50,
      names: ["Studio", "iPad", "iPhone"],
    });
  });
});
