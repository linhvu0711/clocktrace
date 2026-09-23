import {
  ActivitiesReply,
  AppStore,
  activities,
  openStore,
  Store,
} from "@clocktrace/core";
import { seedDay, seedMany } from "@clocktrace/core/testing";
import { NodeContext } from "@effect/platform-node";
import { Console, DateTime, Effect, Exit, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { printActivities } from "../src/activities.js";
import { Style } from "../src/format.js";
import { Prompt } from "../src/prompt.js";
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

const window = "2026-09-18 whole day · America/Los_Angeles";

describe("activities", () => {
  it("activities prints the day, one row per activity", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printActivities(
          { range: { from: "2026-09-18", to: "2026-09-18" } },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      window,
      "  01:00  1h 30m  Code           a  —",
      "  02:30     10m  Google Chrome  b  https://github.com/acme/shop",
    ]);
  });

  it("activities of a partial window keeps the full start and length", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printActivities(
          { range: { from: "2026-09-18T01:00", to: "2026-09-18T02:35" } },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "2026-09-18 01:00 to 02:35 · America/Los_Angeles",
      "  01:00  1h 30m  Code           a  —",
      "  02:30     10m  Google Chrome  b  https://github.com/acme/shop",
    ]);
  });

  it("activities --limit 5 prints five rows and the hint", async () => {
    // Given: 31 one-minute Code Activities from 08:00Z
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 31);
        // When
        yield* printActivities(
          { range: { from: "2026-09-18", to: "2026-09-18" }, limit: 5 },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "2026-09-18 whole day · America/Los_Angeles",
      "  01:00  1m  Code  —  —",
      "  01:01  1m  Code  —  —",
      "  01:02  1m  Code  —  —",
      "  01:03  1m  Code  —  —",
      "  01:04  1m  Code  —  —",
      "  showing 5 of 31 · raise --limit (max 200), narrow the range, or add --app",
    ]);
  });

  it("activities --limit 500 prints 200 rows, the hint, then the capped note", async () => {
    // Given: 205 one-minute Code Activities from 08:00Z
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        yield* printActivities(
          { range: { from: "2026-09-18", to: "2026-09-18" }, limit: 500 },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.length).toBe(203);
    expect(output[1]).toBe("  01:00  1m  Code  —  —");
    expect(output[201]).toBe(
      "  showing 200 of 205 · raise --limit (max 200), narrow the range, or add --app",
    );
    expect(output[202]).toBe("  --limit capped at 200");
  });

  it("activities --app keeps one app", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printActivities(
          {
            range: { from: "2026-09-18", to: "2026-09-18" },
            app: "com.google.Chrome",
          },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      window,
      "  02:30  10m  Google Chrome  b  https://github.com/acme/shop",
    ]);
  });

  it("activities over the cap prints 200 rows and the cap line", async () => {
    // Given: 205 one-minute Code Activities from 08:00Z
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        yield* printActivities(
          { range: { from: "2026-09-18", to: "2026-09-18" } },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.length).toBe(202);
    expect(output[1]).toBe("  01:00  1m  Code  —  —");
    expect(output[201]).toBe(
      "  showing 200 of 205 · raise --limit (max 200), narrow the range, or add --app",
    );
    expect(output.includes("  --limit capped at 200")).toBe(false);
  });

  it("activities --limit caps the rows", async () => {
    // Given: 205 one-minute Code Activities from 08:00Z
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedMany(store, 205);
        // When
        yield* printActivities(
          { range: { from: "2026-09-18", to: "2026-09-18" }, limit: 3 },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output.length).toBe(5);
    expect(output[4]).toBe(
      "  showing 3 of 205 · raise --limit (max 200), narrow the range, or add --app",
    );
  });

  it("activities --json prints the activities tool's JSON", async () => {
    // Given: seedDay
    const input = { range: { from: "2026-09-18", to: "2026-09-18" } };
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printActivities(input, true);
        return yield* Effect.flatMap(
          activities(input),
          Schema.encode(ActivitiesReply),
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
      keys: ["range", "rows", "total", "hasMore"],
    });
  });

  it("activities of an empty window prints the window line and no activity", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printActivities(
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
