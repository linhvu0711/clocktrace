import {
  DateTime,
  Effect,
  Either,
  Layer,
  Option,
  Ref,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import type { StoreShape } from "../src/index.js";
import {
  AppStore,
  AppStoreError,
  classifyAppName,
  iosAppNames,
  lookupAndCache,
  openStore,
  resolveAppName,
  Store,
} from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const run = <A, E>(
  lookup: Layer.Layer<AppStore>,
  body: Effect.Effect<A, E, AppStore | Store | DateTime.CurrentTimeZone>,
): Promise<A> =>
  Effect.runPromise(
    body.pipe(
      DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      Effect.provide(Layer.mergeAll(EmptyStore, lookup)),
    ),
  );

const countingLookup = (
  calls: Ref.Ref<number>,
  answer: Effect.Effect<
    Option.Option<{ name: string; genre: string | null }>,
    AppStoreError
  >,
) =>
  Layer.succeed(
    AppStore,
    new AppStore({
      lookup: () =>
        Ref.update(calls, (n) => n + 1).pipe(Effect.andThen(answer)),
    }),
  );

// Answers per store country and records which countries were asked, in order.
const storeLookup = (
  asked: Ref.Ref<ReadonlyArray<string>>,
  answers: Record<
    string,
    Effect.Effect<
      Option.Option<{ name: string; genre: string | null }>,
      AppStoreError
    >
  >,
) =>
  Layer.succeed(
    AppStore,
    new AppStore({
      lookup: (_, country) =>
        Ref.update(asked, (xs) => [...xs, country]).pipe(
          Effect.andThen(answers[country] ?? Effect.succeed(Option.none())),
        ),
    }),
  );

const seededName = (store: StoreShape) =>
  store.upsertAppName({
    bundleId: "xyz.blueskyweb.app",
    name: "Bluesky",
    genre: "Social Networking",
    fetchedAt: DateTime.unsafeMake("2026-09-18T12:00:00.000Z"),
  });

describe("iosAppNames", () => {
  it("the map holds at least 50 apps", () => {
    // Given: iosAppNames
    // When
    const count = Object.keys(iosAppNames).length;
    // Then
    expect(count).toBeGreaterThanOrEqual(50);
  });
});

describe("classifyAppName", () => {
  it("decides a mapped app locally", async () => {
    // Given: a bundle ID in the built-in map
    // When
    const result = await run(
      AppStore.Test,
      classifyAppName("com.apple.mobilesafari"),
    );
    // Then
    expect(result).toEqual(
      Either.left(Option.some({ name: "Safari", genre: null })),
    );
  });

  it("decides a stored name locally", async () => {
    // Given: a stored Bluesky row
    const result = await run(
      AppStore.Test,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seededName(store);
        return yield* classifyAppName("xyz.blueskyweb.app");
      }),
    );
    // Then
    expect(result).toEqual(
      Either.left(Option.some({ name: "Bluesky", genre: "Social Networking" })),
    );
  });

  it("decides a fresh failed lookup locally", async () => {
    // Given: a name-null row younger than the retry window
    const result = await run(
      AppStore.Test,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.upsertAppName({
          bundleId: "com.example.notanapp",
          name: null,
          genre: null,
          fetchedAt: yield* DateTime.now,
        });
        return yield* classifyAppName("com.example.notanapp");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then
    expect(result).toEqual(Either.left(Option.none()));
  });

  it("asks for a lookup when nothing is cached", async () => {
    // Given: nothing stored for the bundle ID
    // When
    const result = await run(
      AppStore.Test,
      classifyAppName("com.example.notanapp"),
    );
    // Then
    expect(result).toEqual(Either.right("com.example.notanapp"));
  });

  it("asks for a lookup once a failed attempt is stale", async () => {
    // Given: a name-null row older than the retry window
    const result = await run(
      AppStore.Test,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.upsertAppName({
          bundleId: "com.example.notanapp",
          name: null,
          genre: null,
          fetchedAt: yield* DateTime.now,
        });
        yield* TestClock.adjust("25 hours");
        return yield* classifyAppName("com.example.notanapp");
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then
    expect(result).toEqual(Either.right("com.example.notanapp"));
  });
});

describe("lookupAndCache", () => {
  it("a found app is returned and stored", async () => {
    // Given: an empty store and a lookup stub returning Bluesky
    const calls = Ref.unsafeMake(0);
    const lookup = countingLookup(
      calls,
      Effect.succeed(
        Option.some({ name: "Bluesky", genre: "Social Networking" }),
      ),
    );
    // When
    const { result, row } = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* lookupAndCache("xyz.blueskyweb.app");
        const row = yield* store.getAppName("xyz.blueskyweb.app");
        return { result, row };
      }),
    );
    // Then
    expect(result).toEqual(
      Option.some({ name: "Bluesky", genre: "Social Networking" }),
    );
    expect(Option.map(row, (r) => [r.name, r.genre])).toEqual(
      Option.some(["Bluesky", "Social Networking"]),
    );
  });

  it("a failed lookup keeps a name stored while it ran", async () => {
    // Given: a stored Bluesky row and a lookup that fails
    const calls = Ref.unsafeMake(0);
    const lookup = countingLookup(
      calls,
      Effect.fail(new AppStoreError({ cause: "offline" })),
    );
    // When
    const { result, row } = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seededName(store);
        const result = yield* lookupAndCache("xyz.blueskyweb.app");
        const row = yield* store.getAppName("xyz.blueskyweb.app");
        return { result, row };
      }),
    );
    // Then
    expect(result).toEqual(
      Option.some({ name: "Bluesky", genre: "Social Networking" }),
    );
    expect(Option.map(row, (r) => r.name)).toEqual(Option.some("Bluesky"));
  });
});

describe("resolveAppName", () => {
  it("resolveAppName returns the built-in name and no genre", async () => {
    // Given: nothing
    // When
    const result = await run(
      AppStore.Test,
      resolveAppName("com.apple.mobilesafari"),
    );
    // Then
    expect(result).toEqual(Option.some({ name: "Safari", genre: null }));
  });

  it("each system screen resolves to its built-in name without a lookup", async () => {
    // Given: a counting lookup and the system screen bundle IDs
    const calls = Ref.unsafeMake(0);
    const lookup = countingLookup(
      calls,
      Effect.succeed(Option.some({ name: "Other", genre: "News" })),
    );
    const ids = [
      "com.apple.InCallService",
      "com.apple.LocalAuthenticationUIService",
      "com.apple.AppProtectionUIHost",
      "com.apple.AuthKitUIService",
      "com.apple.AuthenticationServicesUI",
      "com.apple.ServicesPaymentAngel",
      "com.apple.PassbookUIService",
      "com.apple.CTNotifyUIService",
      "com.apple.HeadphoneProxService",
      "com.apple.PosterBoard",
      "com.apple.ScreenshotServicesService",
      "com.apple.purplebuddy",
      "com.apple.webapp",
      "com.apple.CoreAuthUI",
      "com.apple.WebSheet",
      "com.apple.SafariViewService",
      "com.apple.PhotosUIService",
    ];
    // When
    const { results, count } = await run(
      lookup,
      Effect.gen(function* () {
        const results = yield* Effect.forEach(ids, resolveAppName);
        return { results, count: yield* Ref.get(calls) };
      }),
    );
    // Then
    expect({ results, count }).toEqual({
      results: [
        "Phone call",
        "Face ID & passcode",
        "Hidden & locked apps",
        "Apple Account sign-in",
        "Sign-in sheet",
        "App Store purchase",
        "Wallet & Apple Pay",
        "Carrier message",
        "Headphone connection",
        "Lock Screen & wallpaper",
        "Screenshot",
        "Setup Assistant",
        "Web app",
        "Passcode",
        "Wi-Fi login",
        "In-app Safari",
        "Photos picker",
      ].map((name) => Option.some({ name, genre: null })),
      count: 0,
    });
  });

  it("a miss is looked up once and cached", async () => {
    // Given: an in-memory store and a lookup stub returning Bluesky
    const calls = Ref.unsafeMake(0);
    const lookup = countingLookup(
      calls,
      Effect.succeed(
        Option.some({ name: "Bluesky", genre: "Social Networking" }),
      ),
    );
    // When
    const { first, second, count, row } = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        const first = yield* resolveAppName("xyz.blueskyweb.app");
        const second = yield* resolveAppName("xyz.blueskyweb.app");
        const row = yield* store.getAppName("xyz.blueskyweb.app");
        return { first, second, count: yield* Ref.get(calls), row };
      }),
    );
    // Then
    expect(first).toEqual(
      Option.some({ name: "Bluesky", genre: "Social Networking" }),
    );
    expect(second).toEqual(
      Option.some({ name: "Bluesky", genre: "Social Networking" }),
    );
    expect(count).toBe(1);
    expect(Option.map(row, (r) => [r.name, r.genre])).toEqual(
      Option.some(["Bluesky", "Social Networking"]),
    );
  });

  it("a stored name is read without a lookup", async () => {
    // Given: a stored Bluesky row and a counting lookup
    const calls = Ref.unsafeMake(0);
    const lookup = countingLookup(
      calls,
      Effect.succeed(Option.some({ name: "Other", genre: "News" })),
    );
    // When
    const { result, count } = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seededName(store);
        const result = yield* resolveAppName("xyz.blueskyweb.app");
        return { result, count: yield* Ref.get(calls) };
      }),
    );
    // Then
    expect(result).toEqual(
      Option.some({ name: "Bluesky", genre: "Social Networking" }),
    );
    expect(count).toBe(0);
  });

  it("resolveAppName returns none for an unmapped id", async () => {
    // Given: nothing
    // When
    const result = await run(
      AppStore.Test,
      resolveAppName("com.example.notanapp"),
    );
    // Then
    expect(result).toEqual(Option.none());
  });

  it("an empty lookup is retried after one day", async () => {
    // Given: a lookup that finds nothing, pinned to a TestClock
    const calls = Ref.unsafeMake(0);
    const lookup = countingLookup(calls, Effect.succeed(Option.none()));
    const { results, countAfterTwo, count, row } = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        const a = yield* resolveAppName("com.example.notanapp");
        const b = yield* resolveAppName("com.example.notanapp");
        const countAfterTwo = yield* Ref.get(calls);
        yield* TestClock.adjust("25 hours");
        const c = yield* resolveAppName("com.example.notanapp");
        const row = yield* store.getAppName("com.example.notanapp");
        return {
          results: [a, b, c],
          countAfterTwo,
          count: yield* Ref.get(calls),
          row,
        };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then
    expect(results).toEqual([Option.none(), Option.none(), Option.none()]);
    expect(countAfterTwo).toBe(1);
    expect(count).toBe(2);
    expect(Option.isSome(row) && row.value.name === null).toBe(true);
  });

  it("an offline lookup fails soft and records the attempt", async () => {
    // Given: a lookup that fails, pinned to a TestClock
    const calls = Ref.unsafeMake(0);
    const lookup = countingLookup(
      calls,
      Effect.fail(new AppStoreError({ cause: "offline" })),
    );
    const { results, count, row } = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        const a = yield* resolveAppName("com.example.notanapp");
        const b = yield* resolveAppName("com.example.notanapp");
        const row = yield* store.getAppName("com.example.notanapp");
        return {
          results: [a, b],
          count: yield* Ref.get(calls),
          row,
        };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then
    expect(results).toEqual([Option.none(), Option.none()]);
    expect(count).toBe(1);
    expect(Option.isSome(row) && row.value.name === null).toBe(true);
  });
});

describe("lookupAndCache store fallback", () => {
  it("a US miss is found in the store of the time zone country", async () => {
    // Given: zone Asia/Saigon, the US store misses, the vn store has CGV
    const asked = Ref.unsafeMake<ReadonlyArray<string>>([]);
    const lookup = storeLookup(asked, {
      us: Effect.succeed(Option.none()),
      vn: Effect.succeed(
        Option.some({ name: "CGV Cinemas", genre: "Entertainment" }),
      ),
    });
    // When
    const outcome = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* resolveAppName("cinema.cgv.vn");
        const row = yield* store.getAppName("cinema.cgv.vn");
        return {
          result,
          asked: yield* Ref.get(asked),
          stored: Option.map(row, (r) => [r.name, r.genre]),
        };
      }).pipe(DateTime.withCurrentZoneNamed("Asia/Saigon")),
    );
    // Then
    expect(outcome).toEqual({
      result: Option.some({ name: "CGV Cinemas", genre: "Entertainment" }),
      asked: ["us", "vn"],
      stored: Option.some(["CGV Cinemas", "Entertainment"]),
    });
  });

  it("a US hit makes one request", async () => {
    // Given: zone Asia/Saigon, both stores have an answer
    const asked = Ref.unsafeMake<ReadonlyArray<string>>([]);
    const lookup = storeLookup(asked, {
      us: Effect.succeed(
        Option.some({ name: "Bluesky", genre: "Social Networking" }),
      ),
      vn: Effect.succeed(Option.some({ name: "Other", genre: "News" })),
    });
    // When
    const outcome = await run(
      lookup,
      Effect.gen(function* () {
        const result = yield* resolveAppName("xyz.blueskyweb.app");
        return { result, asked: yield* Ref.get(asked) };
      }).pipe(DateTime.withCurrentZoneNamed("Asia/Saigon")),
    );
    // Then
    expect(outcome).toEqual({
      result: Option.some({ name: "Bluesky", genre: "Social Networking" }),
      asked: ["us"],
    });
  });

  it("a miss in both stores is stored as a failed lookup", async () => {
    // Given: zone Asia/Saigon, both stores miss
    const asked = Ref.unsafeMake<ReadonlyArray<string>>([]);
    const lookup = storeLookup(asked, {});
    // When
    const outcome = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* resolveAppName("com.example.notanapp");
        const row = yield* store.getAppName("com.example.notanapp");
        return {
          result,
          asked: yield* Ref.get(asked),
          storedName: Option.map(row, (r) => r.name),
        };
      }).pipe(DateTime.withCurrentZoneNamed("Asia/Saigon")),
    );
    // Then
    expect(outcome).toEqual({
      result: Option.none(),
      asked: ["us", "vn"],
      storedName: Option.some(null),
    });
  });

  it("a failing second lookup fails soft", async () => {
    // Given: zone Asia/Saigon, the US store misses, the vn lookup fails
    const asked = Ref.unsafeMake<ReadonlyArray<string>>([]);
    const lookup = storeLookup(asked, {
      us: Effect.succeed(Option.none()),
      vn: Effect.fail(new AppStoreError({ cause: "offline" })),
    });
    // When
    const outcome = await run(
      lookup,
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* resolveAppName("com.example.notanapp");
        const row = yield* store.getAppName("com.example.notanapp");
        return {
          result,
          asked: yield* Ref.get(asked),
          storedName: Option.map(row, (r) => r.name),
        };
      }).pipe(DateTime.withCurrentZoneNamed("Asia/Saigon")),
    );
    // Then
    expect(outcome).toEqual({
      result: Option.none(),
      asked: ["us", "vn"],
      storedName: Option.some(null),
    });
  });

  it("a failing US lookup skips the second store", async () => {
    // Given: zone Asia/Saigon, the US lookup fails, the vn store has CGV
    const asked = Ref.unsafeMake<ReadonlyArray<string>>([]);
    const lookup = storeLookup(asked, {
      us: Effect.fail(new AppStoreError({ cause: "offline" })),
      vn: Effect.succeed(
        Option.some({ name: "CGV Cinemas", genre: "Entertainment" }),
      ),
    });
    // When
    const outcome = await run(
      lookup,
      Effect.gen(function* () {
        const result = yield* resolveAppName("cinema.cgv.vn");
        return { result, asked: yield* Ref.get(asked) };
      }).pipe(DateTime.withCurrentZoneNamed("Asia/Saigon")),
    );
    // Then
    expect(outcome).toEqual({ result: Option.none(), asked: ["us"] });
  });

  it("a time zone with no country makes one request", async () => {
    // Given: zone UTC, both stores miss
    const asked = Ref.unsafeMake<ReadonlyArray<string>>([]);
    const lookup = storeLookup(asked, {});
    // When
    const outcome = await run(
      lookup,
      Effect.gen(function* () {
        const result = yield* resolveAppName("com.example.notanapp");
        return { result, asked: yield* Ref.get(asked) };
      }).pipe(DateTime.withCurrentZoneNamed("UTC")),
    );
    // Then
    expect(outcome).toEqual({ result: Option.none(), asked: ["us"] });
  });

  it("a US time zone makes one request", async () => {
    // Given: the run default zone America/Los_Angeles, both stores miss
    const asked = Ref.unsafeMake<ReadonlyArray<string>>([]);
    const lookup = storeLookup(asked, {});
    // When
    const outcome = await run(
      lookup,
      Effect.gen(function* () {
        const result = yield* resolveAppName("com.example.notanapp");
        return { result, asked: yield* Ref.get(asked) };
      }),
    );
    // Then
    expect(outcome).toEqual({ result: Option.none(), asked: ["us"] });
  });
});
