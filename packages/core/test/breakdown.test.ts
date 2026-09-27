import { DateTime, Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { AppStore, breakdown, openStore, Store } from "../src/index.js";
import { seedBreakdown } from "../src/testing.js";

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
});
