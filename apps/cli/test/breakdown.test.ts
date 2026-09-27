import {
  AppStore,
  addRule,
  type BreakdownBlock,
  BreakdownReply,
  breakdown,
  openStore,
  Store,
} from "@clocktrace/core";
import { seedBreakdown, seedPrivate } from "@clocktrace/core/testing";
import { NodeContext } from "@effect/platform-node";
import {
  Cause,
  Console,
  DateTime,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
} from "effect";
import { describe, expect, it } from "vitest";
import {
  breakdownScreen,
  commaList,
  printBreakdown,
} from "../src/breakdown.js";
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

/** The message of the error an exit failed with, or "" when it did not fail. */
const failure = <A, E extends { message: string }>(
  exit: Exit.Exit<A, E>,
): string =>
  Exit.isFailure(exit)
    ? Option.match(Cause.failureOption(exit.cause), {
        onNone: () => "",
        onSome: (e) => e.message,
      })
    : "";

const day = { from: "2026-09-18", to: "2026-09-18" };
const window = "2026-09-18 whole day · America/Los_Angeles";
const unknownId = "00000000-0000-4000-8000-000000000099";

const small: BreakdownBlock = {
  start: "2026-09-18T11:00-07:00",
  end: "2026-09-18T12:00-07:00",
  seconds: 1845,
  nodes: [
    {
      name: "Code",
      seconds: 1845,
      children: [
        { name: "main.ts", seconds: 1800, children: [] },
        { name: "3 small items", seconds: 45, small: 3, children: [] },
      ],
    },
  ],
};

describe("breakdown", () => {
  it("breakdown prints the window line and the tree by device, app, domain, title", async () => {
    // Given: seedBreakdown
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        const devices = yield* seedBreakdown(store);
        // When
        yield* printBreakdown({ range: day }, false);
        return devices;
      }),
    );
    // Then
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    const { studio, iphone, ipad } = exit.value;
    expect(output).toEqual([
      `${window} · by device, app, domain, title`,
      `1h 15m 25s  Studio  mac · ${studio.id}`,
      "   30m 45s  ├─ Code",
      "   30m 00s  │  ├─ main.ts",
      "       <1m  │  └─ 3 small items",
      "   30m 00s  ├─ Obsidian",
      "   20m 00s  │  ├─ Plan",
      "   10m 00s  │  └─ Journal",
      "   14m 40s  └─ Brave",
      "    6m 40s     ├─ news.ycombinator.com",
      "    6m 40s     │  └─ Hacker News",
      "    6m 00s     ├─ wellfound.com",
      "    6m 00s     │  └─ Jobs",
      "    2m 00s     └─ (no domain)",
      "    2m 00s        └─ New Tab",
      `   30m 00s  iPhone  iphone · ${iphone.id}`,
      "   30m 00s  └─ Game",
      `    5m 00s  iPad  ipad · ${ipad.id}`,
      "    5m 00s  └─ Books",
      "1h 50m 25s  total",
    ]);
  });

  it("breakdown by category tags each Category productive or not", async () => {
    // Given: seedBreakdown; Code is Coding (productive), Brave is Browsing (not)
    const { output } = await runPrint(
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
        yield* printBreakdown({ range: day, groupBy: ["category"] }, false);
      }),
    );
    // Then
    expect(output).toEqual([
      `${window} · by category`,
      "1h 05m 00s  Uncategorized",
      "   30m 45s  Coding  productive",
      "   14m 40s  Browsing  not productive",
      "1h 50m 25s  total",
    ]);
  });

  it("breakdown --json prints the breakdown tool's JSON", async () => {
    // Given: seedBreakdown
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        yield* printBreakdown({ range: day }, true);
        return yield* Effect.flatMap(
          breakdown({ range: day }),
          Schema.encode(BreakdownReply),
        );
      }),
    );
    // Then: the line is core's encoded reply
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    expect({
      lines: output.length,
      parsed: JSON.parse(output[0] ?? ""),
    }).toEqual({ lines: 1, parsed: exit.value });
  });

  it("breakdown --json --block hour prints the breakdown tool's JSON", async () => {
    // Given: seedBreakdown
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        yield* printBreakdown({ range: day, block: "hour" }, true);
        return yield* Effect.flatMap(
          breakdown({ range: day, block: "hour" }),
          Schema.encode(BreakdownReply),
        );
      }),
    );
    // Then: the line is core's encoded reply
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    expect({
      lines: output.length,
      parsed: JSON.parse(output[0] ?? ""),
    }).toEqual({ lines: 1, parsed: exit.value });
  });

  it("breakdown of an empty window prints the note", async () => {
    // Given: seedBreakdown
    const { output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        yield* printBreakdown(
          { range: { from: "2026-09-01", to: "2026-09-01" } },
          false,
        );
      }),
    );
    // Then
    expect(output).toEqual([
      "2026-09-01 whole day · America/Los_Angeles · by device, app, domain, title",
      "no activity in this range",
    ]);
  });

  it("bad group-by and min stop with core's message", async () => {
    // Given: seedBreakdown
    const messages = await Promise.all(
      [
        { range: day, groupBy: ["colour"] },
        { range: day, min: "abc" },
        { range: day, min: "-5s" },
      ].map(async (input) => {
        const { exit } = await runPrint(
          Effect.gen(function* () {
            const store = yield* Store;
            yield* seedBreakdown(store);
            // When
            yield* printBreakdown(input as never, false);
          }),
        );
        return failure(exit);
      }),
    );
    // Then
    expect(messages).toEqual([
      "groupBy.0: must be one of category, project, device, app, domain, title",
      "min: must be a whole number with s or m, as 60s or 2m",
      "min: must be a whole number with s or m, as 60s or 2m",
    ]);
  });

  it("an unknown Device id stops with core's message", async () => {
    // Given: seedBreakdown
    const { exit } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        yield* printBreakdown({ range: day, devices: [unknownId] }, false);
      }),
    );
    // Then
    expect(failure(exit)).toBe(
      `no Device with id ${unknownId} · see breakdown --group-by device`,
    );
  });

  it("commaList splits a flag value on commas", () => {
    // Given: nothing
    // When
    const lists = [
      commaList("mac,iphone"),
      commaList("device, app ,title"),
      commaList(""),
    ];
    // Then
    expect(lists).toEqual([
      ["mac", "iphone"],
      ["device", "app", "title"],
      [""],
    ]);
  });

  it("a long title is cut to the terminal width", () => {
    // Given: a 30-column terminal
    const look = { color: false, unicode: true, width: 30 };
    const block: BreakdownBlock = {
      start: "2026-09-18T11:00-07:00",
      end: "2026-09-18T12:00-07:00",
      seconds: 1800,
      nodes: [
        {
          name: "Code",
          seconds: 1800,
          children: [
            {
              name: "a very long window title that goes on",
              seconds: 1800,
              children: [],
            },
          ],
        },
      ],
    };
    // When
    const lines = breakdownScreen(block, look);
    // Then
    expect(lines).toEqual([
      "30m 00s  Code",
      "30m 00s  └─ a very long windo…",
      "30m 00s  total",
    ]);
  });

  it("breakdownScreen with color off prints no escape codes", () => {
    // Given: color off
    const look = { color: false, unicode: true, width: 0 };
    // When
    const lines = breakdownScreen(small, look);
    // Then
    expect(lines).toEqual([
      "30m 45s  Code",
      "30m 00s  ├─ main.ts",
      "    <1m  └─ 3 small items",
      "30m 45s  total",
    ]);
  });

  it("a small items line is gray when color is on", () => {
    // Given: color on
    const look = { color: true, unicode: true, width: 0 };
    // When
    const lines = breakdownScreen(small, look);
    // Then
    expect(lines).toEqual([
      "30m 45s  Code",
      "30m 00s  ├─ main.ts",
      "    \u001b[0;90m<1m\u001b[0m  └─ \u001b[0;90m3 small items\u001b[0m",
      "30m 45s  \u001b[0;1mtotal\u001b[0m",
    ]);
  });

  it("ASCII guides when the terminal has no Unicode", () => {
    // Given: no Unicode
    const look = { color: false, unicode: false, width: 0 };
    // When
    const lines = breakdownScreen(small, look);
    // Then
    expect(lines).toEqual([
      "30m 45s  Code",
      "30m 00s  |- main.ts",
      "    <1m  \u0060- 3 small items",
      "30m 45s  total",
    ]);
  });

  it("breakdown prints a Private line beside the domains", async () => {
    // Given: seedPrivate, Brave 6m on wellfound.com and 20m Private
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedPrivate(store);
        // When
        yield* printBreakdown(
          { range: day, groupBy: ["app", "domain", "title"] },
          false,
        );
      }),
    );
    // Then
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    expect(output).toEqual([
      `${window} · by app, domain, title`,
      "26m 00s  Brave",
      "20m 00s  ├─ (private)",
      " 6m 00s  └─ wellfound.com",
      " 6m 00s     └─ Jobs",
      "26m 00s  total",
    ]);
  });

  it("breakdown --json names the Private line and marks it private", async () => {
    // Given: seedPrivate
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedPrivate(store);
        // When
        yield* printBreakdown({ range: day, groupBy: ["app", "domain"] }, true);
      }),
    );
    // Then
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    expect(JSON.parse(output[0] ?? "").blocks).toEqual([
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
                seconds: 1200,
                private: true,
                children: [],
              },
              { name: "wellfound.com", seconds: 360, children: [] },
            ],
          },
        ],
      },
    ]);
  });
});
