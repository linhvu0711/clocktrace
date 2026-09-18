import {
  DateTime,
  Effect,
  Either,
  Layer,
  Schema,
  TestClock,
  TestContext,
} from "effect";
import { describe, expect, it } from "vitest";

import type { StoreShape, TimelineBlock } from "../src/index.js";
import {
  ActivitiesInput,
  activities,
  addRule,
  openStore,
  Store,
  summary,
  timeline,
} from "../src/index.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const run = <A, E>(
  effect: Effect.Effect<A, E, Store | DateTime.CurrentTimeZone>,
): Promise<A> =>
  Effect.runPromise(
    effect.pipe(
      DateTime.withCurrentZoneNamed("America/Los_Angeles"),
      Effect.provide(EmptyStore),
    ),
  );

const t = (s: string) => DateTime.unsafeMake(s);

const seedDay = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* store.getOrInsertDevice({
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

const seedLaptop = (store: StoreShape) =>
  Effect.gen(function* () {
    const laptop = yield* store.getOrInsertDevice({
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
      rows: [
        { key: "com.microsoft.VSCode", name: "Code", seconds: 7200 },
        { key: "com.google.Chrome", name: "Google Chrome", seconds: 900 },
      ],
      total: 8100,
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
      rows: [
        { key: studio.id, name: "Studio", seconds: 8100 },
        { key: laptop.id, name: "Laptop", seconds: 600 },
      ],
      total: 8700,
    });
  });

  it("summary with deviceId reads one Device", async () => {
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
          deviceId: laptop.id,
        });
      }),
    );
    // Then
    expect(result).toEqual({
      rows: [{ key: "uncategorized", name: "Uncategorized", seconds: 600 }],
      total: 600,
    });
  });

  it("summary for today reads the current zone and clock", async () => {
    // Given: seedDay and a TestClock pinned at Friday 10:00 PDT
    const { result, coding } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const { coding } = yield* seedDay(store);
        yield* TestClock.setTime(Date.UTC(2026, 8, 18, 17));
        // When
        const result = yield* summary({
          range: "today",
          groupBy: "category",
        });
        return { result, coding };
      }).pipe(Effect.provide(TestContext.TestContext)),
    );
    // Then: a UTC day would count A4 in full and give 9000
    expect(result).toEqual({
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

  it("summary of a range with no Activities gives no rows and total 0", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* summary({
          range: { from: "2026-09-01", to: "2026-09-01" },
          groupBy: "category",
        });
      }),
    );
    // Then
    expect(result).toEqual({ rows: [], total: 0 });
  });

  it("summary rounds each group once, not each Activity", async () => {
    // Given: one Device, no Rules, two Code rows of 500 ms each
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* store.getOrInsertDevice({
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
      rows: [{ key: "com.microsoft.VSCode", name: "Code", seconds: 1 }],
      total: 1,
    });
  });

  it("summary over one year of 100 000 Activities finishes under 2 seconds", async () => {
    // Given: the Starter set and a year of synthetic Activities
    const { elapsed, total } = await Effect.runPromise(
      Effect.gen(function* () {
        const store = yield* Store;
        const device = yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const apps = [
          "com.google.Chrome",
          "com.apple.Safari",
          "com.microsoft.VSCode",
          "com.tinyspeck.slackmacgap",
          "com.apple.Terminal",
          "com.figma.Desktop",
          "com.apple.Notes",
          "com.spotify.client",
          "com.apple.mail",
          "us.zoom.xos",
        ] as const;
        const sites = [
          "https://github.com/acme/shop",
          "https://stackoverflow.com/q/1",
          "https://linear.app/acme",
          "https://docs.google.com/document/d/1",
          "https://notion.so/page",
          "https://app.slack.com/client",
          "https://mail.google.com/mail",
          "https://figma.com/design/1",
          "https://reddit.com/r/rust",
          "https://youtube.com/watch?v=1",
        ] as const;
        const step = Math.floor((365 * 24 * 3600 * 1000) / 100_000);
        for (let i = 0; i < 100_000; i++) {
          const startedAt = Date.UTC(2025, 8, 1) + i * step;
          const bundleId = apps[i % apps.length] ?? "com.apple.Finder";
          const isBrowser =
            bundleId === "com.google.Chrome" || bundleId === "com.apple.Safari";
          yield* store.insertActivity({
            deviceId: device.id,
            bundleId,
            appName: bundleId,
            title: null,
            url: isBrowser ? (sites[i % sites.length] ?? null) : null,
            startedAt: DateTime.unsafeMake(startedAt),
            endedAt: DateTime.unsafeMake(startedAt + step - 1000),
          });
        }
        // When: only the summary call is timed
        const started = performance.now();
        const result = yield* summary({
          range: { from: "2025-09-01", to: "2026-08-31" },
          groupBy: "category",
        });
        const elapsed = performance.now() - started;
        return { elapsed, total: result.total };
      }).pipe(
        DateTime.withCurrentZoneNamed("America/Los_Angeles"),
        Effect.provide(Store.Test),
      ),
    );
    // Then
    expect(elapsed).toBeLessThan(2000);
    expect(total).toBeGreaterThan(0);
  }, 60_000);
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
    expect(isoBlocks(result)).toEqual([
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
        const studio = yield* store.getOrInsertDevice({
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
    expect(isoBlocks(result)).toEqual([
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
        const studio = yield* store.getOrInsertDevice({
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
    expect(isoBlocks(result)).toEqual([
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
        const studio = yield* store.getOrInsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        const laptop = yield* store.getOrInsertDevice({
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
    expect(isoBlocks(result)).toEqual([
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
        const studio = yield* store.getOrInsertDevice({
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
    expect(isoBlocks(result)).toEqual([
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
    expect(isoBlocks(result).map((b) => b.projectName)).toEqual([
      null,
      null,
      "Shop",
    ]);
  });

  it("timeline of a range with no Activities gives no blocks", async () => {
    // Given: seedDay
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        return yield* timeline({
          range: { from: "2026-09-01", to: "2026-09-01" },
        });
      }),
    );
    // Then
    expect(result).toEqual([]);
  });
});

const seedMany = (store: StoreShape, count: number) =>
  Effect.gen(function* () {
    const studio = yield* store.getOrInsertDevice({
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
      range: "today",
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
