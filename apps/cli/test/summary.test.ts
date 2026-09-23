import {
  AppStore,
  addRule,
  InvalidRangeError,
  openStore,
  Store,
  SummaryReply,
  summary,
} from "@clocktrace/core";
import { seedDay, seedTwoDevices } from "@clocktrace/core/testing";
import { NodeContext } from "@effect/platform-node";
import { Console, DateTime, Effect, Exit, Layer, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { Style } from "../src/format.js";
import { Prompt } from "../src/prompt.js";
import { printSummary } from "../src/summary.js";
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

describe("summary", () => {
  it("summary by app prints the app name only", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printSummary(
          { range: { from: "2026-09-18", to: "2026-09-18" }, groupBy: "app" },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      `${window} · by app`,
      "  Code           1h 30m 00s  ██████████████████░░   90%",
      "  Google Chrome     10m 00s  ██░░░░░░░░░░░░░░░░░░   10%",
      "  total          1h 40m 00s",
    ]);
    expect(output.some((l) => l.includes("com.microsoft.VSCode"))).toBe(false);
  });

  it("summary of a partial window prints the times and the clipped rows", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printSummary(
          {
            range: { from: "2026-09-18T01:00", to: "2026-09-18T02:35" },
            groupBy: "app",
          },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "2026-09-18 01:00 to 02:35 · America/Los_Angeles · by app",
      "  Code           1h 30m 00s  ███████████████████░   95%",
      "  Google Chrome      5m 00s  █░░░░░░░░░░░░░░░░░░░    5%",
      "  total          1h 35m 00s",
    ]);
  });

  it("summary by category prints the day, a bar per row, the percent, and productive", async () => {
    // Given: seedDay plus a Coding Category the Code app maps to
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
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
        // When
        yield* printSummary(
          {
            range: { from: "2026-09-18", to: "2026-09-18" },
            groupBy: "category",
          },
          false,
        );
        return coding;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(output).toEqual([
        `${window} · by category`,
        "  Coding         1h 30m 00s  ██████████████████░░   90%  productive",
        "  Uncategorized     10m 00s  ██░░░░░░░░░░░░░░░░░░   10%",
        "  total          1h 40m 00s",
      ]);
    }
  });

  it("summary --json prints the summary tool's JSON", async () => {
    // Given: seedDay
    const input = {
      range: { from: "2026-09-18", to: "2026-09-18" },
      groupBy: "app",
    } as const;
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printSummary(input, true);
        return yield* Effect.flatMap(
          summary(input),
          Schema.encode(SummaryReply),
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

  it("summary --device keeps one Device", async () => {
    // Given: seedTwoDevices; Studio holds both seedDay Activities
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* seedTwoDevices(store);
        // When
        yield* printSummary(
          {
            range: { from: "2026-09-18", to: "2026-09-18" },
            groupBy: "device",
            device: studio.id,
          },
          false,
        );
        return studio;
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    if (Exit.isSuccess(exit)) {
      expect(output).toEqual([
        `${window} · by device`,
        "  Studio  1h 40m 00s  ████████████████████  100%",
        "  total   1h 40m 00s",
      ]);
    }
  });

  it("summary of an empty window prints the window line and no activity", async () => {
    // Given: seedDay
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedDay(store);
        // When
        yield* printSummary(
          { range: { from: "2026-01-01", to: "2026-01-01" }, groupBy: "app" },
          false,
        );
      }),
    );
    // Then
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(output).toEqual([
      "2026-01-01 whole day · America/Los_Angeles · by app",
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
        yield* printSummary(
          { range: { from: "2026-09-08", to: "2026-09-01" }, groupBy: "app" },
          false,
        );
      }),
    );
    // Then
    expect(exit).toEqual(
      Exit.fail(
        new InvalidRangeError({
          field: "range",
          reason: "from 2026-09-08 is after to 2026-09-01",
        }),
      ),
    );
    expect(output).toEqual([]);
  });
});
