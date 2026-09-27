import { DateTime, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppStore,
  addRule,
  breakdown,
  importProgressKey,
  openStore,
  Store,
} from "../src/index.js";
import { seedBreakdown, seedPrivate, seedRuns } from "../src/testing.js";

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

describe("breakdown", () => {
  it("breakdown by device, app, domain, title sums the seeded day", async () => {
    // Given: seedBreakdown, no rules, no categories
    const { result, studio, iphone, ipad } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const devices = yield* seedBreakdown(store);
        // When
        const result = yield* breakdown({ range: day });
        return { result, ...devices };
      }),
    );
    // Then
    expect(result).toEqual({
      range: {
        from: "2026-09-18T00:00",
        to: "2026-09-19T00:00",
        zone: "America/Los_Angeles",
      },
      blocks: [
        {
          start: "2026-09-18T00:00-07:00",
          end: "2026-09-19T00:00-07:00",
          first: "2026-09-18T01:00-07:00",
          last: "2026-09-18T13:05-07:00",
          seconds: 6625,
          nodes: [
            {
              name: "Studio",
              key: studio.id,
              kind: "mac",
              seconds: 4525,
              children: [
                {
                  name: "Code",
                  key: "com.microsoft.VSCode",
                  seconds: 1845,
                  children: [
                    { name: "main.ts", seconds: 1800, children: [] },
                    {
                      name: "3 small items",
                      seconds: 45,
                      small: 3,
                      children: [],
                    },
                  ],
                },
                {
                  name: "Obsidian",
                  key: "md.obsidian",
                  seconds: 1800,
                  children: [
                    { name: "Plan", seconds: 1200, children: [] },
                    { name: "Journal", seconds: 600, children: [] },
                  ],
                },
                {
                  name: "Brave",
                  key: "com.brave.Browser",
                  seconds: 880,
                  children: [
                    {
                      name: "news.ycombinator.com",
                      seconds: 400,
                      children: [
                        { name: "Hacker News", seconds: 400, children: [] },
                      ],
                    },
                    {
                      name: "wellfound.com",
                      seconds: 360,
                      children: [{ name: "Jobs", seconds: 360, children: [] }],
                    },
                    {
                      name: "(no domain)",
                      seconds: 120,
                      children: [
                        { name: "New Tab", seconds: 120, children: [] },
                      ],
                    },
                  ],
                },
              ],
            },
            {
              name: "iPhone",
              key: iphone.id,
              kind: "iphone",
              seconds: 1800,
              children: [
                {
                  name: "Game",
                  key: "com.example.game",
                  seconds: 1800,
                  children: [],
                },
              ],
            },
            {
              name: "iPad",
              key: ipad.id,
              kind: "ipad",
              seconds: 300,
              children: [
                {
                  name: "Books",
                  key: "com.example.books",
                  seconds: 300,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
      notes: [],
    });
  });

  it("a total Block carries the window and its first and last activity", async () => {
    // Given: seedBreakdown
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({ range: day });
      }),
    );
    const { nodes: _nodes, ...block } = result.blocks[0] ?? {
      nodes: [],
    };
    // Then
    expect(block).toEqual({
      start: "2026-09-18T00:00-07:00",
      end: "2026-09-19T00:00-07:00",
      first: "2026-09-18T01:00-07:00",
      last: "2026-09-18T13:05-07:00",
      seconds: 6625,
    });
  });

  it("breakdown of an empty window notes no activity", async () => {
    // Given: seedBreakdown
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({
          range: { from: "2026-09-01", to: "2026-09-01" },
        });
      }),
    );
    // Then
    expect(result).toEqual({
      range: {
        from: "2026-09-01T00:00",
        to: "2026-09-02T00:00",
        zone: "America/Los_Angeles",
      },
      blocks: [
        {
          start: "2026-09-01T00:00-07:00",
          end: "2026-09-02T00:00-07:00",
          seconds: 0,
          nodes: [],
        },
      ],
      notes: ["no activity in this range"],
    });
  });

  it("breakdown by category gives one level with the productive flag", async () => {
    // Given: seedBreakdown; Code is Coding (productive), Brave is Browsing (not)
    const { result, coding, browsing } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        const coding = yield* store.insertCategory({
          name: "Coding",
          productive: true,
        });
        const browsing = yield* store.insertCategory({
          name: "Browsing",
          productive: false,
        });
        yield* addRule({
          field: "app",
          compare: "is",
          value: "com.microsoft.VSCode",
          effect: "category",
          target: coding.id,
        });
        yield* addRule({
          field: "app",
          compare: "is",
          value: "com.brave.Browser",
          effect: "category",
          target: browsing.id,
        });
        // When
        const result = yield* breakdown({ range: day, groupBy: ["category"] });
        return { result, coding, browsing };
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-18T00:00-07:00",
        end: "2026-09-19T00:00-07:00",
        first: "2026-09-18T01:00-07:00",
        last: "2026-09-18T13:05-07:00",
        seconds: 6625,
        nodes: [
          { name: "Uncategorized", seconds: 3900, children: [] },
          {
            name: "Coding",
            key: coding.id,
            productive: true,
            seconds: 1845,
            children: [],
          },
          {
            name: "Browsing",
            key: browsing.id,
            productive: false,
            seconds: 880,
            children: [],
          },
        ],
      },
    ]);
  });

  it("breakdown by project puts unmatched time in No project", async () => {
    // Given: seedBreakdown; Code is in Thesis
    const { result, thesis } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        const thesis = yield* store.insertProject({ name: "Thesis" });
        yield* addRule({
          field: "app",
          compare: "is",
          value: "com.microsoft.VSCode",
          effect: "project",
          target: thesis.id,
        });
        // When
        const result = yield* breakdown({ range: day, groupBy: ["project"] });
        return { result, thesis };
      }),
    );
    // Then
    expect(result.blocks[0]?.nodes).toEqual([
      { name: "No project", seconds: 4780, children: [] },
      { name: "Thesis", key: thesis.id, seconds: 1845, children: [] },
    ]);
  });

  it("a level outside the list is rejected", async () => {
    // Given: an empty store
    const messages = await run(
      // When
      Effect.forEach([["colour"], [], ["app", "app"]], (groupBy) =>
        Effect.map(
          Effect.flip(breakdown({ range: day, groupBy } as never)),
          (error) => error.message,
        ),
      ),
    );
    // Then
    expect(messages).toEqual([
      "groupBy.0: must be one of category, project, device, app, domain, title",
      "groupBy: must name at least one level",
      "groupBy: must not name a level twice",
    ]);
  });

  it("min 0s keeps each small line", async () => {
    // Given: seedBreakdown
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({ range: day, min: "0s" });
      }),
    );
    // Then: Studio, then Code
    expect(result.blocks[0]?.nodes[0]?.children[0]?.children).toEqual([
      { name: "main.ts", seconds: 1800, children: [] },
      { name: "a.ts", seconds: 20, children: [] },
      { name: "b.ts", seconds: 15, children: [] },
      { name: "c.ts", seconds: 10, children: [] },
    ]);
  });

  it("min 11m merges three small lines and keeps a lone one", async () => {
    // Given: seedBreakdown
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({
          range: day,
          groupBy: ["app", "title"],
          min: "11m",
        });
      }),
    );
    // Then
    expect(result.blocks[0]?.nodes).toEqual([
      {
        name: "Code",
        key: "com.microsoft.VSCode",
        seconds: 1845,
        children: [
          { name: "main.ts", seconds: 1800, children: [] },
          { name: "3 small items", seconds: 45, small: 3, children: [] },
        ],
      },
      { name: "Game", key: "com.example.game", seconds: 1800, children: [] },
      {
        name: "Obsidian",
        key: "md.obsidian",
        seconds: 1800,
        children: [
          { name: "Plan", seconds: 1200, children: [] },
          { name: "Journal", seconds: 600, children: [] },
        ],
      },
      {
        name: "Brave",
        key: "com.brave.Browser",
        seconds: 880,
        children: [
          { name: "3 small items", seconds: 880, small: 3, children: [] },
        ],
      },
      { name: "Books", key: "com.example.books", seconds: 300, children: [] },
    ]);
  });

  it("min abc and -5s are rejected", async () => {
    // Given: an empty store
    const messages = await run(
      // When
      Effect.forEach(["abc", "-5s"], (min) =>
        Effect.map(
          Effect.flip(breakdown({ range: day, min })),
          (error) => error.message,
        ),
      ),
    );
    // Then
    expect(messages).toEqual([
      "min: must be a whole number with s or m, as 60s or 2m",
      "min: must be a whole number with s or m, as 60s or 2m",
    ]);
  });

  it("devices mac and iphone leave out the iPad", async () => {
    // Given: seedBreakdown
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({ range: day, devices: ["mac", "iphone"] });
      }),
    );
    // Then
    expect({
      seconds: result.blocks[0]?.seconds,
      names: result.blocks[0]?.nodes.map((n) => n.name),
      notes: result.notes,
    }).toEqual({ seconds: 6325, names: ["Studio", "iPhone"], notes: [] });
  });

  it("devices by id keeps one Device", async () => {
    // Given: seedBreakdown
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const { studio } = yield* seedBreakdown(store);
        // When
        return yield* breakdown({ range: day, devices: [studio.id] });
      }),
    );
    // Then
    expect({
      seconds: result.blocks[0]?.seconds,
      names: result.blocks[0]?.nodes.map((n) => n.name),
    }).toEqual({ seconds: 4525, names: ["Studio"] });
  });

  it("an unknown Device id fails", async () => {
    // Given: seedBreakdown
    const error = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* Effect.flip(
          breakdown({
            range: day,
            devices: ["00000000-0000-4000-8000-000000000099"],
          }),
        );
      }),
    );
    // Then
    expect(`${error._tag} ${error.message}`).toBe(
      "DeviceNotFoundError no Device with id 00000000-0000-4000-8000-000000000099 · see breakdown --group-by device",
    );
  });

  it("a kind with no activity gives an empty tree and a note", async () => {
    // Given: seedBreakdown; 08:00Z to 09:00Z holds only Obsidian
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({
          range: { from: "2026-09-18T01:00", to: "2026-09-18T02:00" },
          devices: ["iphone"],
        });
      }),
    );
    // Then
    expect({ blocks: result.blocks, notes: result.notes }).toEqual({
      blocks: [
        {
          start: "2026-09-18T01:00-07:00",
          end: "2026-09-18T02:00-07:00",
          seconds: 0,
          nodes: [],
        },
      ],
      notes: ["no iphone Device has activity in this range"],
    });
  });

  it("a device that is neither a kind nor an id is rejected", async () => {
    // Given: an empty store
    const messages = await run(
      // When
      Effect.forEach([["phone"], []], (devices) =>
        Effect.map(
          Effect.flip(breakdown({ range: day, devices } as never)),
          (error) => error.message,
        ),
      ),
    );
    // Then
    expect(messages).toEqual([
      "devices.0: must be a Device kind (mac, iphone, ipad) or a Device id",
      "devices: must name at least one Device",
    ]);
  });

  it("a blank level with nothing above it still shows its time", async () => {
    // Given: seedBreakdown; the iPhone's Game has no URL
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({
          range: day,
          groupBy: ["domain"],
          devices: ["iphone"],
        });
      }),
    );
    // Then
    expect({ blocks: result.blocks, notes: result.notes }).toEqual({
      blocks: [
        {
          start: "2026-09-18T00:00-07:00",
          end: "2026-09-19T00:00-07:00",
          first: "2026-09-18T12:00-07:00",
          last: "2026-09-18T12:30-07:00",
          seconds: 1800,
          nodes: [{ name: "(no domain)", seconds: 1800, children: [] }],
        },
      ],
      notes: [],
    });
  });

  it("a Private Activity shows as (private) beside the domains", async () => {
    // Given: seedPrivate, Brave 6m on wellfound.com and 20m Private
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedPrivate(store);
        // When
        return yield* breakdown({
          range: day,
          groupBy: ["app", "domain", "title"],
        });
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-18T00:00-07:00",
        end: "2026-09-19T00:00-07:00",
        first: "2026-09-18T02:00-07:00",
        last: "2026-09-18T02:40-07:00",
        seconds: 1560,
        nodes: [
          {
            name: "Brave",
            key: "com.brave.Browser",
            seconds: 1560,
            children: [
              {
                name: "(private)",
                private: true,
                seconds: 1200,
                children: [],
              },
              {
                name: "wellfound.com",
                seconds: 360,
                children: [{ name: "Jobs", seconds: 360, children: [] }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("an app with only Private time shows (private) as its only line", async () => {
    // Given: Studio with one Private Brave Activity, 20m
    const { result, studio } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* store.upsertDevice({
          kind: "mac",
          name: "Studio",
          externalId: "mac-1",
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.brave.Browser",
          appName: "Brave",
          title: null,
          url: null,
          private: true,
          startedAt: DateTime.unsafeMake("2026-09-18T09:20:00.000Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T09:40:00.000Z"),
        });
        // When
        const result = yield* breakdown({ range: day });
        return { result, studio };
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-18T00:00-07:00",
        end: "2026-09-19T00:00-07:00",
        first: "2026-09-18T02:20-07:00",
        last: "2026-09-18T02:40-07:00",
        seconds: 1200,
        nodes: [
          {
            name: "Studio",
            key: studio.id,
            kind: "mac",
            seconds: 1200,
            children: [
              {
                name: "Brave",
                key: "com.brave.Browser",
                seconds: 1200,
                children: [
                  {
                    name: "(private)",
                    private: true,
                    seconds: 1200,
                    children: [],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("unmarked rows with no title and no URL keep the (no domain) rule beside (private)", async () => {
    // Given: seedPrivate, plus unmarked Brave and Code rows with no title and no URL
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* seedPrivate(store);
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.brave.Browser",
          appName: "Brave",
          title: null,
          url: null,
          startedAt: DateTime.unsafeMake("2026-09-18T09:10:00.000Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T09:12:00.000Z"),
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.microsoft.VSCode",
          appName: "Code",
          title: null,
          url: null,
          startedAt: DateTime.unsafeMake("2026-09-18T11:00:00.000Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T11:30:00.000Z"),
        });
        // When
        return yield* breakdown({
          range: day,
          groupBy: ["app", "domain", "title"],
        });
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-18T00:00-07:00",
        end: "2026-09-19T00:00-07:00",
        first: "2026-09-18T02:00-07:00",
        last: "2026-09-18T04:30-07:00",
        seconds: 3480,
        nodes: [
          {
            name: "Code",
            key: "com.microsoft.VSCode",
            seconds: 1800,
            children: [],
          },
          {
            name: "Brave",
            key: "com.brave.Browser",
            seconds: 1680,
            children: [
              {
                name: "(private)",
                private: true,
                seconds: 1200,
                children: [],
              },
              {
                name: "wellfound.com",
                seconds: 360,
                children: [{ name: "Jobs", seconds: 360, children: [] }],
              },
              { name: "(no domain)", seconds: 120, children: [] },
            ],
          },
        ],
      },
    ]);
  });

  it("hour Blocks from 22:07 start short, then follow the clock", async () => {
    // Given: Code 22:10 to 23:30 local on 2026-09-25
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["a", "2026-09-26T05:10:00.000Z", "2026-09-26T06:30:00.000Z"],
        ]);
        // When
        return yield* breakdown({
          range: { from: "2026-09-25T22:07", to: "2026-09-26T00:00" },
          block: "hour",
          groupBy: ["app"],
        });
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-25T22:07-07:00",
        end: "2026-09-25T23:00-07:00",
        first: "2026-09-25T22:10-07:00",
        last: "2026-09-25T23:00-07:00",
        seconds: 3000,
        nodes: [
          {
            name: "Code",
            key: "com.microsoft.VSCode",
            seconds: 3000,
            children: [],
          },
        ],
      },
      {
        start: "2026-09-25T23:00-07:00",
        end: "2026-09-26T00:00-07:00",
        first: "2026-09-25T23:00-07:00",
        last: "2026-09-25T23:30-07:00",
        seconds: 1800,
        nodes: [
          {
            name: "Code",
            key: "com.microsoft.VSCode",
            seconds: 1800,
            children: [],
          },
        ],
      },
    ]);
  });

  it("an Activity across a Block edge is cut at the edge", async () => {
    // Given: Code 09:14 to 09:17 local
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["a", "2026-09-26T16:14:00.000Z", "2026-09-26T16:17:00.000Z"],
        ]);
        // When
        return yield* breakdown({
          range: { from: "2026-09-26T09:00", to: "2026-09-26T09:30" },
          block: "15min",
          groupBy: ["app"],
        });
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-26T09:00-07:00",
        end: "2026-09-26T09:15-07:00",
        first: "2026-09-26T09:14-07:00",
        last: "2026-09-26T09:15-07:00",
        seconds: 60,
        nodes: [
          {
            name: "Code",
            key: "com.microsoft.VSCode",
            seconds: 60,
            children: [],
          },
        ],
      },
      {
        start: "2026-09-26T09:15-07:00",
        end: "2026-09-26T09:30-07:00",
        first: "2026-09-26T09:15-07:00",
        last: "2026-09-26T09:17-07:00",
        seconds: 120,
        nodes: [
          {
            name: "Code",
            key: "com.microsoft.VSCode",
            seconds: 120,
            children: [],
          },
        ],
      },
    ]);
  });

  it("min merges small lines inside each Block", async () => {
    // Given: b 09:14:00 to 09:14:30, a 09:14:30 to 09:15:30 local
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["b", "2026-09-26T16:14:00.000Z", "2026-09-26T16:14:30.000Z"],
          ["a", "2026-09-26T16:14:30.000Z", "2026-09-26T16:15:30.000Z"],
        ]);
        // When: min 60s by default
        return yield* breakdown({
          range: { from: "2026-09-26T09:00", to: "2026-09-26T09:30" },
          block: "15min",
          groupBy: ["title"],
        });
      }),
    );
    // Then
    expect(result.blocks.map((b) => b.nodes)).toEqual([
      [{ name: "2 small items", seconds: 60, small: 2, children: [] }],
      [{ name: "a", seconds: 30, children: [] }],
    ]);
  });

  it("hour Blocks follow the clock on the day DST ends", async () => {
    // Given: Code over the whole 25-hour day
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["a", "2026-11-01T07:00:00.000Z", "2026-11-02T08:00:00.000Z"],
        ]);
        // When
        return yield* breakdown({
          range: { from: "2026-11-01", to: "2026-11-01" },
          block: "hour",
          groupBy: ["app"],
        });
      }),
    );
    // Then
    expect(result.blocks.map((b) => b.start)).toEqual([
      "2026-11-01T00:00-07:00",
      "2026-11-01T01:00-07:00",
      "2026-11-01T01:00-08:00",
      "2026-11-01T02:00-08:00",
      "2026-11-01T03:00-08:00",
      "2026-11-01T04:00-08:00",
      "2026-11-01T05:00-08:00",
      "2026-11-01T06:00-08:00",
      "2026-11-01T07:00-08:00",
      "2026-11-01T08:00-08:00",
      "2026-11-01T09:00-08:00",
      "2026-11-01T10:00-08:00",
      "2026-11-01T11:00-08:00",
      "2026-11-01T12:00-08:00",
      "2026-11-01T13:00-08:00",
      "2026-11-01T14:00-08:00",
      "2026-11-01T15:00-08:00",
      "2026-11-01T16:00-08:00",
      "2026-11-01T17:00-08:00",
      "2026-11-01T18:00-08:00",
      "2026-11-01T19:00-08:00",
      "2026-11-01T20:00-08:00",
      "2026-11-01T21:00-08:00",
      "2026-11-01T22:00-08:00",
      "2026-11-01T23:00-08:00",
    ]);
  });

  it("hour Blocks follow the clock on the day DST starts", async () => {
    // Given: Code over the whole 23-hour day
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["a", "2026-03-08T08:00:00.000Z", "2026-03-09T07:00:00.000Z"],
        ]);
        // When
        return yield* breakdown({
          range: { from: "2026-03-08", to: "2026-03-08" },
          block: "hour",
          groupBy: ["app"],
        });
      }),
    );
    // Then
    expect(result.blocks.map((b) => b.start)).toEqual([
      "2026-03-08T00:00-08:00",
      "2026-03-08T01:00-08:00",
      "2026-03-08T03:00-07:00",
      "2026-03-08T04:00-07:00",
      "2026-03-08T05:00-07:00",
      "2026-03-08T06:00-07:00",
      "2026-03-08T07:00-07:00",
      "2026-03-08T08:00-07:00",
      "2026-03-08T09:00-07:00",
      "2026-03-08T10:00-07:00",
      "2026-03-08T11:00-07:00",
      "2026-03-08T12:00-07:00",
      "2026-03-08T13:00-07:00",
      "2026-03-08T14:00-07:00",
      "2026-03-08T15:00-07:00",
      "2026-03-08T16:00-07:00",
      "2026-03-08T17:00-07:00",
      "2026-03-08T18:00-07:00",
      "2026-03-08T19:00-07:00",
      "2026-03-08T20:00-07:00",
      "2026-03-08T21:00-07:00",
      "2026-03-08T22:00-07:00",
      "2026-03-08T23:00-07:00",
    ]);
  });

  it("a block outside total, hour, 15min is rejected", async () => {
    // Given: an empty store
    const message = await run(
      // When
      Effect.map(
        Effect.flip(breakdown({ range: day, block: "5min" } as never)),
        (error) => error.message,
      ),
    );
    // Then
    expect(message).toBe("block: must be one of total, hour, 15min");
  });

  it("a run of Blocks with no activity is one empty Block", async () => {
    // Given: Code 17:50 to 18:00 and 21:30 to 21:40 local on 2026-09-26
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["a", "2026-09-27T00:50:00.000Z", "2026-09-27T01:00:00.000Z"],
          ["a", "2026-09-27T04:30:00.000Z", "2026-09-27T04:40:00.000Z"],
        ]);
        // When
        return yield* breakdown({
          range: { from: "2026-09-26T17:45", to: "2026-09-26T21:45" },
          block: "15min",
          groupBy: ["app"],
        });
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-26T17:45-07:00",
        end: "2026-09-26T18:00-07:00",
        first: "2026-09-26T17:50-07:00",
        last: "2026-09-26T18:00-07:00",
        seconds: 600,
        nodes: [
          {
            name: "Code",
            key: "com.microsoft.VSCode",
            seconds: 600,
            children: [],
          },
        ],
      },
      {
        start: "2026-09-26T18:00-07:00",
        end: "2026-09-26T21:30-07:00",
        seconds: 0,
        nodes: [],
      },
      {
        start: "2026-09-26T21:30-07:00",
        end: "2026-09-26T21:45-07:00",
        first: "2026-09-26T21:30-07:00",
        last: "2026-09-26T21:40-07:00",
        seconds: 600,
        nodes: [
          {
            name: "Code",
            key: "com.microsoft.VSCode",
            seconds: 600,
            children: [],
          },
        ],
      },
    ]);
  });

  it("an empty window in hour Blocks is one empty Block with the note", async () => {
    // Given: seedBreakdown
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({
          range: { from: "2026-09-01", to: "2026-09-01" },
          block: "hour",
        });
      }),
    );
    // Then
    expect({ blocks: result.blocks, notes: result.notes }).toEqual({
      blocks: [
        {
          start: "2026-09-01T00:00-07:00",
          end: "2026-09-02T00:00-07:00",
          seconds: 0,
          nodes: [],
        },
      ],
      notes: ["no activity in this range"],
    });
  });

  it("an empty window in hour Blocks is one empty Block, as in total", async () => {
    // Given: an empty store
    const result = await run(
      // When
      breakdown({
        range: { from: "2026-09-26T09:00", to: "2026-09-26T09:00" },
        block: "hour",
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-26T09:00-07:00",
        end: "2026-09-26T09:00-07:00",
        seconds: 0,
        nodes: [],
      },
    ]);
  });

  it("search wellfound and WellFound give the same tree of matching time", async () => {
    // Given: seedBreakdown
    const { lower, upper, studio } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const { studio } = yield* seedBreakdown(store);
        // When
        const lower = yield* breakdown({ range: day, search: "wellfound" });
        const upper = yield* breakdown({ range: day, search: "WellFound" });
        return { lower, upper, studio };
      }),
    );
    // Then
    const tree = {
      blocks: [
        {
          start: "2026-09-18T00:00-07:00",
          end: "2026-09-19T00:00-07:00",
          first: "2026-09-18T02:00-07:00",
          last: "2026-09-18T02:06-07:00",
          seconds: 360,
          nodes: [
            {
              name: "Studio",
              key: studio.id,
              kind: "mac",
              seconds: 360,
              children: [
                {
                  name: "Brave",
                  key: "com.brave.Browser",
                  seconds: 360,
                  children: [
                    {
                      name: "wellfound.com",
                      seconds: 360,
                      children: [{ name: "Jobs", seconds: 360, children: [] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      notes: [],
    };
    expect([
      { blocks: lower.blocks, notes: lower.notes },
      { blocks: upper.blocks, notes: upper.notes },
    ]).toEqual([tree, tree]);
  });

  it("search github.com/clocktrace matches the URL path", async () => {
    // Given: seedBreakdown, a Pull request on github.com/clocktrace and an
    // Effect page on github.com/Effect-TS
    const { result, studio } = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        const { studio } = yield* seedBreakdown(store);
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.brave.Browser",
          appName: "Brave",
          title: "Pull request",
          url: "https://github.com/clocktrace/clocktrace/pull/244",
          startedAt: DateTime.unsafeMake("2026-09-18T10:30:00.000Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T10:40:00.000Z"),
        });
        yield* store.insertActivity({
          deviceId: studio.id,
          bundleId: "com.brave.Browser",
          appName: "Brave",
          title: "Effect",
          url: "https://github.com/Effect-TS/effect",
          startedAt: DateTime.unsafeMake("2026-09-18T10:40:00.000Z"),
          endedAt: DateTime.unsafeMake("2026-09-18T10:45:00.000Z"),
        });
        // When
        const result = yield* breakdown({
          range: day,
          search: "github.com/clocktrace",
        });
        return { result, studio };
      }),
    );
    // Then
    expect(result.blocks).toEqual([
      {
        start: "2026-09-18T00:00-07:00",
        end: "2026-09-19T00:00-07:00",
        first: "2026-09-18T03:30-07:00",
        last: "2026-09-18T03:40-07:00",
        seconds: 600,
        nodes: [
          {
            name: "Studio",
            key: studio.id,
            kind: "mac",
            seconds: 600,
            children: [
              {
                name: "Brave",
                key: "com.brave.Browser",
                seconds: 600,
                children: [
                  {
                    name: "github.com",
                    seconds: 600,
                    children: [
                      { name: "Pull request", seconds: 600, children: [] },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("a search with no match notes no activity", async () => {
    // Given: seedBreakdown; the iPhone's Game row has no title and no URL
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({ range: day, search: "game" });
      }),
    );
    // Then
    expect({ blocks: result.blocks, notes: result.notes }).toEqual({
      blocks: [
        {
          start: "2026-09-18T00:00-07:00",
          end: "2026-09-19T00:00-07:00",
          seconds: 0,
          nodes: [],
        },
      ],
      notes: ["no activity in this range"],
    });
  });

  it("a search with no iPhone match does not say the iPhone has no activity", async () => {
    // Given: seedBreakdown; the iPhone has a Game Activity with no title or URL
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        return yield* breakdown({
          range: day,
          devices: ["iphone"],
          search: "github",
        });
      }),
    );
    // Then
    expect(result.notes).toEqual(["no activity in this range"]);
  });

  it("search empty is rejected", async () => {
    // Given: seedBreakdown
    const message = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        const error = yield* Effect.flip(breakdown({ range: day, search: "" }));
        return error.message;
      }),
    );
    // Then
    expect(message).toBe("search: must not be empty");
  });

  it("a late iPhone gets one note and the Mac none", async () => {
    // Given: seedBreakdown, iPhone Progress at 15:00Z; its last Activity
    // ends 19:30Z, 12:30 in Los Angeles
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        yield* store.setSetting(
          importProgressKey("iphone-1"),
          '{"segment":"s1","offset":0,"ts":1789743600}',
        );
        // When
        return yield* breakdown({ range: day });
      }),
    );
    // Then
    expect(result.notes).toEqual([
      "iPhone data up to 2026-09-18 12:30; later time is not in yet",
    ]);
  });

  it("devices mac gets no iPhone note", async () => {
    // Given: seedBreakdown with a late iPhone
    const result = await run(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        yield* store.setSetting(
          importProgressKey("iphone-1"),
          '{"segment":"s1","offset":0,"ts":1789743600}',
        );
        // When
        return yield* breakdown({ range: day, devices: ["mac"] });
      }),
    );
    // Then
    expect(result.notes).toEqual([]);
  });
});
