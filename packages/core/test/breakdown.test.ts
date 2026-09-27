import { DateTime, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  AppStore,
  addRule,
  breakdown,
  openStore,
  Store,
} from "../src/index.js";
import { seedBreakdown, seedPrivate } from "../src/testing.js";

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
      blocks: [{ seconds: 0, nodes: [] }],
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
      blocks: [{ seconds: 0, nodes: [] }],
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
});
