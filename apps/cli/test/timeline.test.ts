import {
  type InvalidRangeError,
  openStore,
  Store,
  type StoreShape,
} from "@clocktrace/core";
import { NodeContext } from "@effect/platform-node";
import { Console, DateTime, Effect, Exit, Layer } from "effect";
import { describe, expect, it } from "vitest";

import { Style } from "../src/format.js";
import { Prompt } from "../src/prompt.js";
import { printTimeline } from "../src/timeline.js";
import * as MockConsole from "./mock-console.js";
import * as MockTerminal from "./mock-terminal.js";

const EmptyStore = Layer.scoped(
  Store,
  Effect.map(openStore(":memory:"), (shape) => new Store(shape)),
);

const runPrint = <A, E>(
  body: Effect.Effect<A, E, Store | Prompt | DateTime.CurrentTimeZone | Style>,
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const terminal = yield* MockTerminal.make(false);
      const console = yield* MockConsole.make;
      const exit = yield* Effect.exit(
        Effect.scoped(
          body.pipe(
            DateTime.withCurrentZoneNamed("America/Los_Angeles"),
            Effect.provide(
              Layer.mergeAll(
                Console.setConsole(console),
                NodeContext.layer,
                terminal.layer,
                Prompt.Default,
                EmptyStore,
                Style.Test,
              ),
            ),
          ),
        ),
      );
      const output = yield* console.getLines({ stripAnsi: true });
      return { exit, output };
    }),
  );

const t = (s: string) => DateTime.unsafeMake(s);

// Studio: Code 08:00 to 09:30Z, then Chrome to 09:40Z; 01:00 to 02:40 in Los Angeles
const seedDay = (store: StoreShape) =>
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

describe("timeline", () => {
  it("timeline prints the day, one row per block, then the total", async () => {
    // Given: seedDay; no Rules, so every block is Uncategorized
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printTimeline(
          { range: { from: "2026-09-18", to: "2026-09-18" } },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "2026-09-18 whole day · America/Los_Angeles",
      "  01:00  1h 30m  Code           Uncategorized  —",
      "  02:30     10m  Google Chrome  Uncategorized  —",
      "  2 blocks · 1h 40m 00s",
    ]);
  });

  it("timeline of a partial window clips the blocks and the total", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printTimeline(
          { range: { from: "2026-09-18T01:00", to: "2026-09-18T02:35" } },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "2026-09-18 01:00 to 02:35 · America/Los_Angeles",
      "  01:00  1h 30m  Code           Uncategorized  —",
      "  02:30      5m  Google Chrome  Uncategorized  —",
      "  2 blocks · 1h 35m 00s",
    ]);
  });

  it("timeline --json prints the timeline tool's JSON", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printTimeline(
          { range: { from: "2026-09-18", to: "2026-09-18" } },
          true,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.length).toBe(1);
    expect(JSON.parse(output[0] ?? "")).toEqual({
      range: {
        from: "2026-09-18T00:00",
        to: "2026-09-19T00:00",
        zone: "America/Los_Angeles",
      },
      rows: [
        {
          start: "2026-09-18T08:00:00.000Z",
          end: "2026-09-18T09:30:00.000Z",
          app: "Code",
          categoryName: "Uncategorized",
          projectName: null,
        },
        {
          start: "2026-09-18T09:30:00.000Z",
          end: "2026-09-18T09:40:00.000Z",
          app: "Google Chrome",
          categoryName: "Uncategorized",
          projectName: null,
        },
      ],
      total: 2,
    });
  });

  it("timeline of an empty window prints the window line and no activity", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printTimeline(
          { range: { from: "2026-01-01", to: "2026-01-01" } },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "2026-01-01 whole day · America/Los_Angeles",
      "no activity",
    ]);
  });

  it("to before from is an error naming range", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printTimeline(
          { range: { from: "2026-09-08", to: "2026-09-01" } },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit) && exit.cause._tag === "Fail") {
      const error = exit.cause.error as InvalidRangeError;
      expect(error.message).toBe(
        "range: from 2026-09-08 is after to 2026-09-01",
      );
    }
    expect(output).toEqual([]);
  });
});
