import {
  DateTime,
  Effect,
  Either,
  Layer,
  Option,
  Schema,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import type { StoreShape, TimelineBlock } from "../src/index.js";
import {
  ActivitiesInput,
  AppStore,
  activities,
  addRule,
  emptyNote,
  openStore,
  Store,
  SummaryReply,
  summary,
  TimelineReply,
  timeline,
} from "../src/index.js";

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

const dayWindow = {
  from: "2026-09-18T00:00",
  to: "2026-09-19T00:00",
  zone: "America/Los_Angeles",
};
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

const seedLaptop = (store: StoreShape) =>
  Effect.gen(function* () {
    const laptop = yield* store.upsertDevice({
      kind: "mac",
      name: "Laptop",
      externalId: "mac-2",
    });
    yield* store.insertActivity({
      deviceId: laptop.id,
      bundleId: "com.apple.Safari",
      appName: "Safari",
      title: "e",
      url: null,
      startedAt: t("2026-09-18T10:00:00.000Z"),
      endedAt: t("2026-09-18T10:10:00.000Z"),
    });
    return laptop;
  });

describe("summary", () => {
  it("summary by category sums seconds and puts unmatched time in Uncategorized", async () => {
    // Given: the seedDay Activities; A4 straddles local midnight at 07:00Z
    const { result, coding } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const { coding } = yield* seedDay(store);
        // When
        const result = yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "category",
        });
        return { result, coding };
      }),
    );
    // Then: A1 is 5400 s, A4 clips to 1800 s, A2 and A3 are 900 s unmatched
    expect(result).toEqual({
      range: dayWindow,
      rows: [
        {
          key: coding.id,
          name: "Coding",
          seconds: 7200,
          productive: true,
        },
        { key: "uncategorized", name: "Uncategorized", seconds: 900 },
      ],
      total: 8100,
    });
  });

  it("summary by project names time with no Project", async () => {
    // Given: seedDay plus a Shop project and a domain rule for github.com
    const { result, shop } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        const shop = yield* store.insertProject({ name: "Shop" });
        yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "project",
          target: shop.id,
        });
        // When
        const result = yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "project",
        });
        return { result, shop };
      }),
    );
    // Then
    expect(result).toEqual({
      range: dayWindow,
      rows: [
        { key: "no-project", name: "No project", seconds: 7200 },
        { key: shop.id, name: "Shop", seconds: 900 },
      ],
      total: 8100,
    });
  });

  it("summary by app keys by bundle id and names by app name", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "app",
        });
      }),
    );
    // Then
    expect(result).toEqual({
      range: dayWindow,
      rows: [
        { key: "com.microsoft.VSCode", name: "Code", seconds: 7200 },
        { key: "com.google.Chrome", name: "Google Chrome", seconds: 900 },
      ],
      total: 8100,
    });
  });

  it("summary by app shows a Stand-in id app as one app by its name", async () => {
    // Given: two Activities of a Wine game with a Stand-in id
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "noid:QSanguosha.exe",
          appName: "QSanguosha.exe",
          title: null,
          url: null,
          startedAt: t("2026-09-18T10:00:00.000Z"),
          endedAt: t("2026-09-18T10:30:00.000Z"),
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "noid:QSanguosha.exe",
          appName: "QSanguosha.exe",
          title: null,
          url: null,
          startedAt: t("2026-09-18T10:30:00.000Z"),
          endedAt: t("2026-09-18T10:45:00.000Z"),
        });
        // When
        return yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "app",
        });
      }),
    );
    // Then
    expect(result).toEqual({
      range: dayWindow,
      rows: [
        { key: "noid:QSanguosha.exe", name: "QSanguosha.exe", seconds: 2700 },
      ],
      total: 2700,
    });
  });

  it("summary by app shows the resolved name keyed by bundle id", async () => {
    // Given: seedIphone
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedIphone(store);
        // When
        return yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "app",
        });
      }),
    );
    // Then
    expect(result).toEqual({
      range: dayWindow,
      rows: [{ key: "com.apple.mobilesafari", name: "Safari", seconds: 1800 }],
      total: 1800,
    });
  });

  it("summary by device", async () => {
    // Given: seedDay plus a second Device with one Safari Activity
    const { result, studio, laptop } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const { studio } = yield* seedDay(store);
        const laptop = yield* seedLaptop(store);
        // When
        const result = yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "device",
        });
        return { result, studio, laptop };
      }),
    );
    // Then
    expect(result).toEqual({
      range: dayWindow,
      rows: [
        { key: studio.id, name: "Studio", seconds: 8100 },
        { key: laptop.id, name: "Laptop", seconds: 600 },
      ],
      total: 8700,
    });
  });

  it("summary with device reads one Device", async () => {
    // Given: the two-Device seed
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        const laptop = yield* seedLaptop(store);
        // When
        return yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "category",
          device: laptop.id,
        });
      }),
    );
    // Then
    expect(result).toEqual({
      range: dayWindow,
      rows: [{ key: "uncategorized", name: "Uncategorized", seconds: 600 }],
      total: 600,
    });
  });

  it("summary reads a local day in the current zone and clock", async () => {
    // Given: seedDay and a TestClock pinned at Friday 10:00 PDT
    const { result, coding } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const { coding } = yield* seedDay(store);
        yield* TestClock.setTime(Date.UTC(2026, 8, 18, 17));
        // When: the 18th read in the pinned zone, not a UTC day
        const result = yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "category",
        });
        return { result, coding };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then: a UTC day would count A4 in full and give 9000
    expect(result).toEqual({
      range: dayWindow,
      rows: [
        {
          key: coding.id,
          name: "Coding",
          seconds: 7200,
          productive: true,
        },
        { key: "uncategorized", name: "Uncategorized", seconds: 900 },
      ],
      total: 8100,
    });
  });

  it("summary replies with the window first, then rows and total", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        const reply = yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "app",
        });
        return yield* Schema.encode(SummaryReply)(reply);
      }),
    );
    // Then
    expect({
      keys: Object.keys(result),
      range: result.range,
      total: result.total,
    }).toEqual({
      keys: ["range", "rows", "total"],
      range: dayWindow,
      total: 8100,
    });
  });

  it("summary of an empty range ends with the note", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        const reply = yield* summary({
          range: { from: "2026-09-01", to: "2026-09-01" },
          groupBy: "category",
        });
        return yield* Schema.encode(SummaryReply)(reply);
      }),
    );
    // Then
    expect({ reply: result, keys: Object.keys(result) }).toEqual({
      reply: {
        range: emptyWindow,
        rows: [],
        total: 0,
        note: "no activity in this range",
      },
      keys: ["range", "rows", "total", "note"],
    });
  });

  it("summary fails naming device on an id that is not a Device id", async () => {
    // Given: seedDay
    const error = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* Effect.flip(
          summary({
            range: { from: "2026-09-18", to: "2026-09-18" },
            groupBy: "app",
            device: "Studio",
          }),
        );
      }),
    );
    // Then
    expect({ tag: error._tag, message: error.message }).toEqual({
      tag: "InvalidInputError",
      message: "device: must be a Device id",
    });
  });

  it("summary rounds each group once, not each Activity", async () => {
    // Given: one Device, no Rules, two Code rows of 500 ms each
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.microsoft.VSCode",
          appName: "Code",
          title: null,
          url: null,
          startedAt: t("2026-09-18T10:00:00.000Z"),
          endedAt: t("2026-09-18T10:00:00.500Z"),
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.microsoft.VSCode",
          appName: "Code",
          title: null,
          url: null,
          startedAt: t("2026-09-18T10:00:00.500Z"),
          endedAt: t("2026-09-18T10:00:01.000Z"),
        });
        // When
        return yield* summary({
          range: { from: "2026-09-18", to: "2026-09-18" },
          groupBy: "app",
        });
      }),
    );
    // Then: 1000 ms is one second, not two rounded halves
    expect(result).toEqual({
      range: dayWindow,
      rows: [{ key: "com.microsoft.VSCode", name: "Code", seconds: 1 }],
      total: 1,
    });
  });
});

const isoBlocks = (blocks: ReadonlyArray<TimelineBlock>) =>
  blocks.map((b) => ({
    start: DateTime.formatIso(b.start),
    end: DateTime.formatIso(b.end),
    app: b.app,
    categoryName: b.categoryName,
    projectName: b.projectName,
  }));

describe("timeline", () => {
  it("timeline shows the built-in name for an iPhone Activity", async () => {
    // Given: seedIphone
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedIphone(store);
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(isoBlocks(result.rows)).toEqual([
      {
        start: "2026-09-18T19:00:00.000Z",
        end: "2026-09-18T19:30:00.000Z",
        app: "Safari",
        categoryName: "Uncategorized",
        projectName: null,
      },
    ]);
  });

  it("timeline shows the looked-up name", async () => {
    // Given: seedIphone with an unmapped id; the lookup knows it
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedIphone(store, "xyz.blueskyweb.app");
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        }).pipe(
          Effect.provide(
            Layer.succeed(
              AppStore,
              new AppStore({
                lookup: () =>
                  Effect.succeed(
                    Option.some({
                      name: "Bluesky",
                      genre: "Social Networking",
                    }),
                  ),
              }),
            ),
          ),
        );
      }),
    );
    // Then
    expect(isoBlocks(result.rows).map((b) => b.app)).toEqual(["Bluesky"]);
  });

  it("an iOS Activity without a Rule lands in the genre Category", async () => {
    // Given: seedIphone with an unmapped id, a Social category, no rules
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedIphone(store, "com.burbn.instagram");
        yield* store.insertCategory({
          name: "Social",
          productive: false,
        });
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        }).pipe(
          Effect.provide(
            Layer.succeed(
              AppStore,
              new AppStore({
                lookup: () =>
                  Effect.succeed(
                    Option.some({
                      name: "Instagram",
                      genre: "Social Networking",
                    }),
                  ),
              }),
            ),
          ),
        );
      }),
    );
    // Then
    expect(isoBlocks(result.rows).map((b) => b.categoryName)).toEqual([
      "Social",
    ]);
  });

  it("an unmapped iOS bundle id keeps its bundle id", async () => {
    // Given: seedIphone with an unmapped bundle id
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedIphone(store, "com.example.notanapp");
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(isoBlocks(result.rows).map((b) => b.app)).toEqual([
      "com.example.notanapp",
    ]);
  });

  it("a Mac Activity keeps its stored name", async () => {
    // Given: seedDay (mac, appName "Code")
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(isoBlocks(result.rows)[0]?.app).toBe("Code");
  });

  it("timeline merges adjacent Activities with the same app and Category", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then: A4 clips to the range start, A2 and A3 merge into one block
    expect(isoBlocks(result.rows)).toEqual([
      {
        start: "2026-09-18T07:00:00.000Z",
        end: "2026-09-18T07:30:00.000Z",
        app: "Code",
        categoryName: "Coding",
        projectName: null,
      },
      {
        start: "2026-09-18T08:00:00.000Z",
        end: "2026-09-18T09:30:00.000Z",
        app: "Code",
        categoryName: "Coding",
        projectName: null,
      },
      {
        start: "2026-09-18T09:30:00.000Z",
        end: "2026-09-18T09:45:00.000Z",
        app: "Google Chrome",
        categoryName: "Uncategorized",
        projectName: null,
      },
    ]);
  });

  it("timeline splits a block when the Category changes", async () => {
    // Given: one Device, a github.com Category rule, two adjacent Chrome rows
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
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
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "category",
          target: coding.id,
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.google.Chrome",
          appName: "Google Chrome",
          title: "a",
          url: "https://github.com/acme/shop",
          startedAt: t("2026-09-18T10:00:00.000Z"),
          endedAt: t("2026-09-18T10:10:00.000Z"),
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.google.Chrome",
          appName: "Google Chrome",
          title: "b",
          url: "https://www.youtube.com/watch?v=1",
          startedAt: t("2026-09-18T10:10:00.000Z"),
          endedAt: t("2026-09-18T10:20:00.000Z"),
        });
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(isoBlocks(result.rows)).toEqual([
      {
        start: "2026-09-18T10:00:00.000Z",
        end: "2026-09-18T10:10:00.000Z",
        app: "Google Chrome",
        categoryName: "Coding",
        projectName: null,
      },
      {
        start: "2026-09-18T10:10:00.000Z",
        end: "2026-09-18T10:20:00.000Z",
        app: "Google Chrome",
        categoryName: "Uncategorized",
        projectName: null,
      },
    ]);
  });

  it("timeline splits a block when the Project changes", async () => {
    // Given: one Device, two domain Project rules, two adjacent Chrome rows
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const shop = yield* store.insertProject({ name: "Shop" });
        const site = yield* store.insertProject({ name: "Site" });
        yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "project",
          target: shop.id,
        });
        yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "example.com",
          effect: "project",
          target: site.id,
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.google.Chrome",
          appName: "Google Chrome",
          title: "a",
          url: "https://github.com/acme/shop",
          startedAt: t("2026-09-18T10:00:00.000Z"),
          endedAt: t("2026-09-18T10:10:00.000Z"),
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.google.Chrome",
          appName: "Google Chrome",
          title: "b",
          url: "https://www.example.com/",
          startedAt: t("2026-09-18T10:10:00.000Z"),
          endedAt: t("2026-09-18T10:20:00.000Z"),
        });
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then: same app and Category, but each block keeps its own Project
    expect(isoBlocks(result.rows)).toEqual([
      {
        start: "2026-09-18T10:00:00.000Z",
        end: "2026-09-18T10:10:00.000Z",
        app: "Google Chrome",
        categoryName: "Uncategorized",
        projectName: "Shop",
      },
      {
        start: "2026-09-18T10:10:00.000Z",
        end: "2026-09-18T10:20:00.000Z",
        app: "Google Chrome",
        categoryName: "Uncategorized",
        projectName: "Site",
      },
    ]);
  });

  it("timeline keeps two Devices apart", async () => {
    // Given: no Rules; Code on Studio, then Code on Laptop right after
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const laptop = yield* store.upsertDevice({
          kind: "mac",
          name: "Laptop",
          externalId: "mac-2",
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.microsoft.VSCode",
          appName: "Code",
          title: "a",
          url: null,
          startedAt: t("2026-09-18T10:00:00.000Z"),
          endedAt: t("2026-09-18T10:10:00.000Z"),
        });
        yield* store.insertActivity({
          deviceId: laptop.id,
          bundleId: "com.microsoft.VSCode",
          appName: "Code",
          title: "b",
          url: null,
          startedAt: t("2026-09-18T10:10:00.000Z"),
          endedAt: t("2026-09-18T10:20:00.000Z"),
        });
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then: same app and Category, but one block per Device
    expect(isoBlocks(result.rows)).toEqual([
      {
        start: "2026-09-18T10:00:00.000Z",
        end: "2026-09-18T10:10:00.000Z",
        app: "Code",
        categoryName: "Uncategorized",
        projectName: null,
      },
      {
        start: "2026-09-18T10:10:00.000Z",
        end: "2026-09-18T10:20:00.000Z",
        app: "Code",
        categoryName: "Uncategorized",
        projectName: null,
      },
    ]);
  });

  it("timeline keeps a gap over 60 seconds as two blocks", async () => {
    // Given: one Device, no Rules, three Code rows with a 30 s and a 61 s gap
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const insert = (from: string, to: string) =>
          store.insertActivity({
            deviceId: studio.id,
            bundleId: "com.microsoft.VSCode",
            appName: "Code",
            title: null,
            url: null,
            startedAt: t(from),
            endedAt: t(to),
          });
        yield* insert("2026-09-18T10:00:00.000Z", "2026-09-18T10:10:00.000Z");
        yield* insert("2026-09-18T10:10:30.000Z", "2026-09-18T10:20:00.000Z");
        yield* insert("2026-09-18T10:21:01.000Z", "2026-09-18T10:30:00.000Z");
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(isoBlocks(result.rows)).toEqual([
      {
        start: "2026-09-18T10:00:00.000Z",
        end: "2026-09-18T10:20:00.000Z",
        app: "Code",
        categoryName: "Uncategorized",
        projectName: null,
      },
      {
        start: "2026-09-18T10:21:01.000Z",
        end: "2026-09-18T10:30:00.000Z",
        app: "Code",
        categoryName: "Uncategorized",
        projectName: null,
      },
    ]);
  });

  it("timeline names the Project", async () => {
    // Given: seedDay plus a Shop project and a github.com project rule
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        const shop = yield* store.insertProject({ name: "Shop" });
        yield* addRule({
          field: "domain",
          compare: "ends with",
          value: "github.com",
          effect: "project",
          target: shop.id,
        });
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect(isoBlocks(result.rows).map((b) => b.projectName)).toEqual([
      null,
      null,
      "Shop",
    ]);
  });

  it("timeline of an empty range ends with the note", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        const reply = yield* timeline({
          range: { from: "2026-09-01", to: "2026-09-01" },
        });
        return yield* Schema.encode(TimelineReply)(reply);
      }),
    );
    // Then
    expect({ reply: result, keys: Object.keys(result) }).toEqual({
      reply: {
        range: emptyWindow,
        rows: [],
        total: 0,
        note: "no activity in this range",
      },
      keys: ["range", "rows", "total", "note"],
    });
  });

  it("timeline counts its blocks in total", async () => {
    // Given: seedDay; A4, A1, then A2 and A3 merged
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* timeline({
          range: { from: "2026-09-18", to: "2026-09-18" },
        });
      }),
    );
    // Then
    expect({ total: result.total, blocks: result.rows.length }).toEqual({
      total: 3,
      blocks: 3,
    });
  });
});

const seedMany = (store: StoreShape, count: number) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    for (let i = 0; i < count; i++) {
      const startedAt = Date.UTC(2026, 8, 18, 8) + i * 60_000;
      yield* store.insertActivity({
        deviceId: studio.id,
        bundleId: "com.microsoft.VSCode",
        appName: "Code",
        title: null,
        url: null,
        startedAt: DateTime.unsafeMake(startedAt),
        endedAt: DateTime.unsafeMake(startedAt + 60_000),
      });
    }
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

  it("activities clamps a limit under 1 and its Schema rejects it", async () => {
    // Given: the 205-row seed
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        return yield* activities({
          range: { from: "2026-09-18", to: "2026-09-18" },
          limit: -1,
        });
      }),
    );
    // Then: no rows, never a slice from the end
    expect(result.rows).toHaveLength(0);
    expect(result.total).toBe(205);
    expect(result.hasMore).toBe(true);
    const decoded = Schema.decodeUnknownEither(ActivitiesInput)({
      range: { from: "2026-09-18", to: "2026-09-18" },
      limit: 0,
    });
    expect(Either.isLeft(decoded)).toBe(true);
    if (Either.isLeft(decoded)) {
      expect(decoded.left.message).toContain('["limit"]');
    }
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

  it("activities of a range with no Activities gives no rows, total 0, hasMore false", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* activities({
          range: { from: "2026-09-01", to: "2026-09-01" },
        });
      }),
    );
    // Then
    expect(result).toEqual({ rows: [], total: 0, hasMore: false });
  });
});

describe("emptyNote", () => {
  it("names an empty window and stays silent otherwise", () => {
    // Given: nothing
    // When
    const empty = emptyNote([]);
    const nonEmpty = emptyNote([1]);
    // Then
    expect(empty).toEqual({ note: "no activity in this range" });
    expect(nonEmpty).toEqual({});
  });
});
