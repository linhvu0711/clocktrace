import { DateTime, Effect, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";

import type { StoreShape } from "../src/index.js";
import {
  ActivitiesReply,
  AppStore,
  activities,
  addRule,
  openStore,
  Store,
} from "../src/index.js";
import { seedMany } from "../src/testing.js";

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

const t = (s: string) => DateTime.unsafeMake(s);

const emptyWindow = {
  from: "2026-09-01T00:00",
  to: "2026-09-02T00:00",
  zone: "America/Los_Angeles",
};

const seedDay = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    const coding = yield* store.insertCategory({
      name: "Coding",
      productive: true,
    });
    yield* addRule({
      field: "app",
      compare: "is",
      value: "com.microsoft.VSCode",
      effect: "category",
      target: coding.id,
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.microsoft.VSCode",
      appName: "Code",
      title: "a",
      url: null,
      startedAt: t("2026-09-18T08:00:00.000Z"),
      endedAt: t("2026-09-18T09:30:00.000Z"),
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.google.Chrome",
      appName: "Google Chrome",
      title: "b",
      url: "https://github.com/acme/shop",
      startedAt: t("2026-09-18T09:30:00.000Z"),
      endedAt: t("2026-09-18T09:40:00.000Z"),
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.google.Chrome",
      appName: "Google Chrome",
      title: "c",
      url: "https://github.com/acme/shop",
      startedAt: t("2026-09-18T09:40:00.000Z"),
      endedAt: t("2026-09-18T09:45:00.000Z"),
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.microsoft.VSCode",
      appName: "Code",
      title: "d",
      url: null,
      startedAt: t("2026-09-18T06:30:00.000Z"),
      endedAt: t("2026-09-18T07:30:00.000Z"),
    });
    return { studio, coding };
  });

const seedIphone = (store: StoreShape, bundleId = "com.apple.mobilesafari") =>
  Effect.gen(function* () {
    const iphone = yield* store.upsertDevice({
      kind: "iphone",
      name: "iPhone",
      externalId: "iphone-1",
    });
    yield* store.insertActivity({
      deviceId: iphone.id,
      bundleId,
      appName: bundleId,
      title: null,
      url: null,
      startedAt: t("2026-09-18T19:00:00.000Z"),
      endedAt: t("2026-09-18T19:30:00.000Z"),
    });
    return iphone;
  });

describe("activities", () => {
  it("activities returns the resolved name in appName", async () => {
    // Given: seedIphone
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedIphone(store);
        // When
        return yield* activities({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(result.rows[0]?.appName).toBe("Safari");
    expect(result.rows[0]?.bundleId).toBe("com.apple.mobilesafari");
  });

  it("activities returns at most 200 rows with total and hasMore", async () => {
    // Given: 205 one-minute Code Activities from 08:00Z
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        return yield* activities({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(result.rows).toHaveLength(200);
    expect(result.total).toBe(205);
    expect(result.hasMore).toBe(true);
    expect(DateTime.formatIso(result.rows[0]?.startedAt as DateTime.Utc)).toBe(
      "2026-09-18T08:00:00.000Z",
    );
  });

  it("activities honours a smaller limit and caps a larger one", async () => {
    // Given: the 205-row seed
    const { small, large } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        const small = yield* activities({
          range: { from: "2026-09-18", to: "2026-09-18" },
          limit: 10,
        });
        const large = yield* activities({
          range: { from: "2026-09-18", to: "2026-09-18" },
          limit: 500,
        });
        return { small, large };
      }),
    );
    // Then
    expect(small.rows).toHaveLength(10);
    expect(small.total).toBe(205);
    expect(small.hasMore).toBe(true);
    expect(large.rows).toHaveLength(200);
  });

  it("activities over a limit of 200 says capped", async () => {
    // Given: the 205-row seed
    const { over, at } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        const over = yield* Effect.flatMap(
          activities({
            range: { from: "2026-09-18", to: "2026-09-18" },
            limit: 500,
          }),
          Schema.encode(ActivitiesReply),
        );
        const at = yield* Effect.flatMap(
          activities({
            range: { from: "2026-09-18", to: "2026-09-18" },
            limit: 200,
          }),
          Schema.encode(ActivitiesReply),
        );
        return { over, at };
      }),
    );
    // Then: only the capped call carries the key
    expect({
      capped: over.capped,
      rows: over.rows.length,
      overKeys: Object.keys(over),
      atKeys: Object.keys(at),
    }).toEqual({
      capped: true,
      rows: 200,
      overKeys: ["range", "rows", "total", "hasMore", "capped"],
      atKeys: ["range", "rows", "total", "hasMore"],
    });
  });

  it("activities fails naming limit on a limit under 1 or not whole", async () => {
    // Given: the 205-row seed
    const messages = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        return yield* Effect.forEach([0, -1, Number.NaN, 1.5], (limit) =>
          Effect.map(
            Effect.flip(
              activities({
                range: { from: "2026-09-18", to: "2026-09-18" },
                limit,
              }),
            ),
            (error) => `${error._tag} ${error.message}`,
          ),
        );
      }),
    );
    // Then
    expect(messages).toEqual([
      "InvalidInputError limit: must be a whole number above 0",
      "InvalidInputError limit: must be a whole number above 0",
      "InvalidInputError limit: must be a whole number above 0",
      "InvalidInputError limit: must be a whole number above 0",
    ]);
  });

  it("activities filters by app case folded", async () => {
    // Given: seedDay
    const { byName, byBundleId } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        const byName = yield* activities({
          range: { from: "2026-09-18", to: "2026-09-18" },
          app: "code",
        });
        const byBundleId = yield* activities({
          range: { from: "2026-09-18", to: "2026-09-18" },
          app: "COM.GOOGLE.CHROME",
        });
        return { byName, byBundleId };
      }),
    );
    // Then
    expect(byName.total).toBe(2);
    expect(byName.hasMore).toBe(false);
    expect(byName.rows.map((r) => r.bundleId)).toEqual([
      "com.microsoft.VSCode",
      "com.microsoft.VSCode",
    ]);
    expect(byBundleId.total).toBe(2);
    expect(byBundleId.rows.map((r) => r.appName)).toEqual([
      "Google Chrome",
      "Google Chrome",
    ]);
  });

  it("activities of an empty range ends with the note", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        const reply = yield* activities({
          range: { from: "2026-09-01", to: "2026-09-01" },
        });
        return yield* Schema.encode(ActivitiesReply)(reply);
      }),
    );
    // Then
    expect({ reply: result, keys: Object.keys(result) }).toEqual({
      reply: {
        range: emptyWindow,
        rows: [],
        total: 0,
        hasMore: false,
        note: "no activity in this range",
      },
      keys: ["range", "rows", "total", "hasMore", "note"],
    });
  });
});
