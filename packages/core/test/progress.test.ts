import { DateTime, Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  dataUpTo,
  importProgressKey,
  openStore,
  readProgress,
  Store,
} from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const run = <A, E>(effect: Effect.Effect<A, E, Store>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(EmptyStore)));

// An iPhone with one Activity that ends 2026-09-18T19:30Z.
const seedIphone = (store: Store) =>
  Effect.gen(function* () {
    const device = yield* store.upsertDevice({
      kind: "iphone",
      name: "iPhone",
      externalId: "iphone-1",
    });
    yield* store.insertActivity({
      deviceId: device.id,
      bundleId: "com.example.game",
      appName: "Game",
      title: null,
      url: null,
      startedAt: DateTime.unsafeMake("2026-09-18T19:00:00.000Z"),
      endedAt: DateTime.unsafeMake("2026-09-18T19:30:00.000Z"),
    });
    return device;
  });

describe("progress", () => {
  it("dataUpTo is the last Activity end when Progress is older", async () => {
    // Given: an iPhone Activity to 19:30Z and Progress at 15:00Z
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* seedIphone(store);
        yield* store.setSetting(
          importProgressKey("iphone-1"),
          '{"segment":"s1","offset":0,"ts":1789743600}',
        );
        // When
        return Option.map(yield* dataUpTo(store, device), DateTime.formatIso);
      }),
    );
    // Then
    expect(result).toEqual(Option.some("2026-09-18T19:30:00.000Z"));
  });

  it("dataUpTo is the Progress time when it is later", async () => {
    // Given: an iPhone Activity to 19:30Z and Progress at 2026-09-19T12:00Z
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* seedIphone(store);
        yield* store.setSetting(
          importProgressKey("iphone-1"),
          '{"segment":"s1","offset":0,"ts":1789819200}',
        );
        // When
        return Option.map(yield* dataUpTo(store, device), DateTime.formatIso);
      }),
    );
    // Then
    expect(result).toEqual(Option.some("2026-09-19T12:00:00.000Z"));
  });

  it("dataUpTo is none with no Progress and no Activity", async () => {
    // Given: an iPhone Device only
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.upsertDevice({
          kind: "iphone",
          name: "iPhone",
          externalId: "iphone-1",
        });
        // When
        return yield* dataUpTo(store, device);
      }),
    );
    // Then
    expect(result).toEqual(Option.none());
  });

  it("readProgress is none for a value that does not decode", async () => {
    // Given: a Progress setting that is not JSON
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.setSetting(importProgressKey("iphone-1"), "not json");
        // When
        return yield* readProgress(store, "iphone-1");
      }),
    );
    // Then
    expect(result).toEqual(Option.none());
  });
});
