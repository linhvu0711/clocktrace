// Test seeds shared by the CLI and MCP tests, published as
// @clocktrace/core/testing so no app test holds its own copy.
import { DateTime, Effect, Schema } from "effect";

import { ImportProgress, importProgressKey } from "./progress.js";
import type { StoreShape } from "./store.js";

const t = (s: string) => DateTime.unsafeMake(s);

// Studio: Code 08:00 to 09:30Z, then Chrome to 09:40Z; 01:00 to 02:40 in Los Angeles
export const seedDay = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
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
    return studio;
  });

// seedDay plus a Laptop with one Safari Activity, 10:00 to 10:05Z
export const seedTwoDevices = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* seedDay(store);
    const laptop = yield* store.upsertDevice({
      kind: "mac",
      name: "Laptop",
      externalId: "mac-2",
    });
    yield* store.insertActivity({
      deviceId: laptop.id,
      bundleId: "com.apple.Safari",
      appName: "Safari",
      title: "c",
      url: null,
      startedAt: t("2026-09-18T10:00:00.000Z"),
      endedAt: t("2026-09-18T10:05:00.000Z"),
    });
    return studio;
  });

// Studio with Obsidian (no URL), Brave (two Domains, 40 short visits, one
// row with no URL) and Code (one long title, three short ones); an iPhone
// with Game and an iPad with Books. 4525 s, 1800 s, 300 s on 2026-09-18.
// Progress for the iPhone and the iPad is past the day, so its data is in.
export const seedBreakdown = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    const iphone = yield* store.upsertDevice({
      kind: "iphone",
      name: "iPhone",
      externalId: "iphone-1",
    });
    const ipad = yield* store.upsertDevice({
      kind: "ipad",
      name: "iPad",
      externalId: "ipad-1",
    });
    // 2026-09-19T12:00Z, after the day ends at 07:00Z.
    for (const externalId of ["iphone-1", "ipad-1"]) {
      yield* store.setSetting(
        importProgressKey(externalId),
        Schema.encodeSync(ImportProgress)({
          segment: "seed",
          offset: 0,
          ts: 1789819200,
        }),
      );
    }
    const rows: ReadonlyArray<
      readonly [
        string,
        string,
        string,
        string | null,
        string | null,
        string,
        string,
      ]
    > = [
      [
        studio.id,
        "md.obsidian",
        "Obsidian",
        "Plan",
        null,
        "08:00:00",
        "08:20:00",
      ],
      [
        studio.id,
        "md.obsidian",
        "Obsidian",
        "Journal",
        null,
        "08:20:00",
        "08:30:00",
      ],
      [
        studio.id,
        "com.brave.Browser",
        "Brave",
        "Jobs",
        "https://wellfound.com/jobs",
        "09:00:00",
        "09:06:00",
      ],
      [
        studio.id,
        "com.brave.Browser",
        "Brave",
        "New Tab",
        null,
        "09:10:00",
        "09:12:00",
      ],
      [
        studio.id,
        "com.microsoft.VSCode",
        "Code",
        "main.ts",
        null,
        "11:00:00",
        "11:30:00",
      ],
      [
        studio.id,
        "com.microsoft.VSCode",
        "Code",
        "a.ts",
        null,
        "11:30:00",
        "11:30:20",
      ],
      [
        studio.id,
        "com.microsoft.VSCode",
        "Code",
        "b.ts",
        null,
        "11:30:20",
        "11:30:35",
      ],
      [
        studio.id,
        "com.microsoft.VSCode",
        "Code",
        "c.ts",
        null,
        "11:30:35",
        "11:30:45",
      ],
      [
        iphone.id,
        "com.example.game",
        "Game",
        null,
        null,
        "19:00:00",
        "19:30:00",
      ],
      [
        ipad.id,
        "com.example.books",
        "Books",
        null,
        null,
        "20:00:00",
        "20:05:00",
      ],
    ];
    for (const [deviceId, bundleId, appName, title, url, start, end] of rows) {
      yield* store.insertActivity({
        deviceId,
        bundleId,
        appName,
        title,
        url,
        startedAt: t(`2026-09-18T${start}.000Z`),
        endedAt: t(`2026-09-18T${end}.000Z`),
      });
    }
    const tenAm = Date.UTC(2026, 8, 18, 10);
    for (let i = 0; i < 40; i++) {
      yield* store.insertActivity({
        deviceId: studio.id,
        bundleId: "com.brave.Browser",
        appName: "Brave",
        title: "Hacker News",
        url: `https://news.ycombinator.com/item?id=${i}`,
        startedAt: DateTime.unsafeMake(tenAm + i * 10_000),
        endedAt: DateTime.unsafeMake(tenAm + (i + 1) * 10_000),
      });
    }
    return { studio, iphone, ipad };
  });

// Studio: Brave on wellfound.com 09:00 to 09:06Z and a Private Brave window 09:20 to 09:40Z on 2026-09-18.
export const seedPrivate = (store: StoreShape) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.brave.Browser",
      appName: "Brave",
      title: "Jobs",
      url: "https://wellfound.com/jobs",
      startedAt: t("2026-09-18T09:00:00.000Z"),
      endedAt: t("2026-09-18T09:06:00.000Z"),
    });
    yield* store.insertActivity({
      deviceId: studio.id,
      bundleId: "com.brave.Browser",
      appName: "Brave",
      title: null,
      url: null,
      private: true,
      startedAt: t("2026-09-18T09:20:00.000Z"),
      endedAt: t("2026-09-18T09:40:00.000Z"),
    });
    return studio;
  });

// count one-minute Code Activities on Studio from 08:00Z
export const seedMany = (store: StoreShape, count: number) =>
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

// Studio: one Brave Activity per visit, title, URL, and UTC start and end as given.
export const seedVisits = (
  store: StoreShape,
  visits: ReadonlyArray<
    readonly [
      title: string | null,
      url: string | null,
      start: string,
      end: string,
    ]
  >,
) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    for (const [title, url, start, end] of visits) {
      yield* store.insertActivity({
        deviceId: studio.id,
        bundleId: "com.brave.Browser",
        appName: "Brave",
        title,
        url,
        startedAt: t(start),
        endedAt: t(end),
      });
    }
    return studio;
  });

// Studio: one YouTube video for 26m on 2026-09-18, its URL fixed while Brave
// adds "Audio playing" and "High memory usage - N MB" to the title, N moving.
export const seedVideo = (store: StoreShape) => {
  const base =
    "Top 2 in the World with my MAIN Deck for Season End 👑 - YouTube";
  const url = "https://www.youtube.com/watch?v=111fgmmrnKc";
  const mb = [914, 921, 928, 935, 942, 950, 957, 963, 970, 977, 984];
  let at = Date.UTC(2026, 8, 18, 14, 7, 40);
  const visits: Array<
    readonly [string | null, string | null, string, string]
  > = [
    [
      `${base} - Brave`,
      url,
      "2026-09-18T14:00:00.000Z",
      "2026-09-18T14:01:40.000Z",
    ],
    [
      `${base} - Audio playing - Brave`,
      url,
      "2026-09-18T14:01:40.000Z",
      "2026-09-18T14:07:40.000Z",
    ],
    ...mb.map((n): readonly [string, string, string, string] => {
      const start = at;
      at += 100_000;
      return [
        `${base} - Audio playing - High memory usage - ${n} MB - Brave`,
        url,
        new Date(start).toISOString(),
        new Date(at).toISOString(),
      ];
    }),
  ];
  return seedVisits(store, visits);
};

// Studio: one Code Activity per run, title and UTC start and end as given.
export const seedRuns = (
  store: StoreShape,
  runs: ReadonlyArray<readonly [title: string, start: string, end: string]>,
) =>
  Effect.gen(function* () {
    const studio = yield* store.upsertDevice({
      kind: "mac",
      name: "Studio",
      externalId: "mac-1",
    });
    for (const [title, start, end] of runs) {
      yield* store.insertActivity({
        deviceId: studio.id,
        bundleId: "com.microsoft.VSCode",
        appName: "Code",
        title,
        url: null,
        startedAt: t(start),
        endedAt: t(end),
      });
    }
    return studio;
  });
