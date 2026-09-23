import {
  AppStore,
  openStore,
  Store,
  TimelineReply,
  timeline,
} from "@clocktrace/core";
import { seedDay } from "@clocktrace/core/testing";
import { NodeContext } from "@effect/platform-node";
import { Console, DateTime, Effect, Exit, Layer, Schema } from "effect";
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
  body: Effect.Effect<
    A,
    E,
    Store | AppStore | Prompt | DateTime.CurrentTimeZone | Style
  >,
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
                AppStore.Test,
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
    const input = { range: { from: "2026-09-18", to: "2026-09-18" } };
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printTimeline(input, true);
        return yield* Effect.flatMap(
          timeline(input),
          Schema.encode(TimelineReply),
        );
      }),
    );
    // Then: the line is core's encoded reply, keys in order
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    const parsed = JSON.parse(output[0] ?? "");
    expect({
      lines: output.length,
      parsed,
      keys: Object.keys(parsed),
    }).toEqual({
      lines: 1,
      parsed: exit.value,
      keys: ["range", "rows", "total"],
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
});
