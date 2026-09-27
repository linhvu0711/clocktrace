import {
  AppStore,
  addRule,
  type BreakdownBlock,
  BreakdownReply,
  breakdown,
  importProgressKey,
  openStore,
  Store,
} from "@clocktrace/core";
import {
  seedBreakdown,
  seedPrivate,
  seedRuns,
  seedVideo,
} from "@clocktrace/core/testing";
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
  blocksScreen,
  breakdownScreen,
  commaList,
  noteLine,
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

  it("breakdown --json names a page by its top title with its URL and path", async () => {
    // Given: seedVideo, 13 titles on one URL for 26m
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedVideo(store);
        // When
        yield* printBreakdown({ range: day, groupBy: ["page"] }, true);
      }),
    );
    // Then
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    expect(JSON.parse(output[0] ?? "").blocks[0]?.nodes).toEqual([
      {
        name: "Top 2 in the World with my MAIN Deck for Season End 👑 - YouTube - Audio playing - Brave",
        key: "https://www.youtube.com/watch?v=111fgmmrnKc",
        path: "/watch?v=111fgmmrnKc",
        seconds: 1560,
        children: [],
      },
    ]);
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
      "! no activity in this range",
    ]);
  });

  it("search empty stops with core's message", async () => {
    // Given: seedBreakdown
    const { exit } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        yield* printBreakdown({ range: day, search: "" }, false);
      }),
    );
    // Then
    expect(failure(exit)).toBe("search: must not be empty");
  });

  it("breakdown prints a late iPhone note once at the top", async () => {
    // Given: seedBreakdown, iPhone Progress at 15:00Z; its last Activity
    // ends 19:30Z, 12:30 in Los Angeles
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        const devices = yield* seedBreakdown(store);
        yield* store.setSetting(
          importProgressKey("iphone-1"),
          '{"segment":"s1","offset":0,"ts":1789743600}',
        );
        // When
        yield* printBreakdown({ range: day }, false);
        return devices;
      }),
    );
    // Then
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    expect({
      top: output.slice(0, 3),
      count: output.filter((l) => l.includes("data up to")).length,
    }).toEqual({
      top: [
        `${window} · by device, app, domain, title`,
        "! iPhone data up to 2026-09-18 12:30; later time is not in yet",
        `1h 15m 25s  Studio  mac · ${exit.value.studio.id}`,
      ],
      count: 1,
    });
  });

  it("breakdown --json carries the late note text", async () => {
    // Given: seedBreakdown with a late iPhone
    const { output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        yield* store.setSetting(
          importProgressKey("iphone-1"),
          '{"segment":"s1","offset":0,"ts":1789743600}',
        );
        // When
        yield* printBreakdown({ range: day }, true);
      }),
    );
    // Then
    expect(JSON.parse(output[0] ?? "").notes).toEqual([
      "iPhone data up to 2026-09-18 12:30; later time is not in yet",
    ]);
  });

  it("a note is yellow with a ! when color is on", () => {
    // Given: color on
    const look = { color: true, unicode: true, width: 0 };
    // When
    const text = noteLine("no activity in this range", look);
    // Then
    expect(text).toBe("\u001b[0;33m! no activity in this range\u001b[0m");
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
      "groupBy.0: must be one of category, project, device, app, domain, title, page",
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

  it("a page line shows its path in gray after the title", () => {
    // Given: color on
    const look = { color: true, unicode: true, width: 0 };
    const block: BreakdownBlock = {
      start: "2026-09-18T00:00-07:00",
      end: "2026-09-19T00:00-07:00",
      seconds: 360,
      nodes: [
        {
          name: "Jobs",
          key: "https://wellfound.com/jobs",
          path: "/jobs",
          seconds: 360,
          children: [],
        },
      ],
    };
    // When
    const lines = breakdownScreen(block, look);
    // Then
    expect(lines).toEqual([
      "6m 00s  Jobs  \u001b[0;90m/jobs\u001b[0m",
      "6m 00s  \u001b[0;1mtotal\u001b[0m",
    ]);
  });

  it("a long page title is cut and its path kept", () => {
    // Given: a 60-column terminal
    const look = { color: false, unicode: true, width: 60 };
    const block: BreakdownBlock = {
      start: "2026-09-18T00:00-07:00",
      end: "2026-09-19T00:00-07:00",
      seconds: 1560,
      nodes: [
        {
          name: "www.youtube.com",
          seconds: 1560,
          children: [
            {
              name: "Top 2 in the World with my MAIN Deck for Season End 👑 - YouTube - Audio playing - Brave",
              key: "https://www.youtube.com/watch?v=111fgmmrnKc",
              path: "/watch?v=111fgmmrnKc",
              seconds: 1560,
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
      "26m 00s  www.youtube.com",
      "26m 00s  └─ Top 2 in the World with m…  /watch?v=111fgmmrnKc",
      "26m 00s  total",
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

  it("breakdown --block 15min prints one tree per quarter-hour", async () => {
    // Given: Code 09:01 to 09:14 and 09:20 to 09:25 local on 2026-09-26
    const { exit, output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        const studio = yield* seedRuns(store, [
          ["a", "2026-09-26T16:01:00.000Z", "2026-09-26T16:14:00.000Z"],
          ["a", "2026-09-26T16:20:00.000Z", "2026-09-26T16:25:00.000Z"],
        ]);
        // When
        yield* printBreakdown(
          {
            range: { from: "2026-09-25T22:00", to: "2026-09-26T22:00" },
            block: "15min",
          },
          false,
        );
        return studio;
      }),
    );
    // Then
    if (Exit.isFailure(exit)) {
      throw new Error(String(exit.cause));
    }
    const studio = exit.value;
    expect(output).toEqual([
      "2026-09-25 22:00 to 2026-09-26 22:00 · America/Los_Angeles · by device, app, domain, title · per 15min",
      "22:00–09:00   no activity",
      "",
      "2026-09-26",
      "09:00–09:15   first 09:01 · last 09:14",
      `13m 00s  Studio  mac · ${studio.id}`,
      "13m 00s  └─ Code",
      "13m 00s     └─ a",
      "13m 00s  total",
      "",
      "09:15–09:30   first 09:20 · last 09:25",
      `5m 00s  Studio  mac · ${studio.id}`,
      "5m 00s  └─ Code",
      "5m 00s     └─ a",
      "5m 00s  total",
      "",
      "09:30–22:00   no activity",
    ]);
  });

  it("a Block header is bold with first and last in gray", () => {
    // Given: color on
    const look = { color: true, unicode: true, width: 0 };
    // When
    const lines = blocksScreen(
      [
        {
          start: "2026-09-26T09:00-07:00",
          end: "2026-09-26T09:15-07:00",
          first: "2026-09-26T09:01-07:00",
          last: "2026-09-26T09:14-07:00",
          seconds: 780,
          nodes: [{ name: "Code", seconds: 780, children: [] }],
        },
      ],
      look,
    );
    // Then
    expect(lines).toEqual([
      "\u001b[0;1m09:00–09:15\u001b[0m   \u001b[0;90mfirst 09:01 · last 09:14\u001b[0m",
      "13m 00s  Code",
      "13m 00s  \u001b[0;1mtotal\u001b[0m",
    ]);
  });

  it("breakdown --block hour from 22:07 prints 22:07–23:00, then 23:00–00:00", async () => {
    // Given: Code 22:10 to 23:30 local on 2026-09-25
    const { output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["a", "2026-09-26T05:10:00.000Z", "2026-09-26T06:30:00.000Z"],
        ]);
        // When
        yield* printBreakdown(
          {
            range: { from: "2026-09-25T22:07", to: "2026-09-26T00:00" },
            block: "hour",
            groupBy: ["app"],
          },
          false,
        );
      }),
    );
    // Then
    expect(output).toEqual([
      "2026-09-25 22:07 to 2026-09-26 00:00 · America/Los_Angeles · by app · per hour",
      "22:07–23:00   first 22:10 · last 23:00",
      "50m 00s  Code",
      "50m 00s  total",
      "",
      "23:00–00:00   first 23:00 · last 23:30",
      "30m 00s  Code",
      "30m 00s  total",
    ]);
  });

  it("a run of empty Blocks prints one no activity line", async () => {
    // Given: Code 17:50 to 18:00 and 21:30 to 21:40 local on 2026-09-26
    const { output } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedRuns(store, [
          ["a", "2026-09-27T00:50:00.000Z", "2026-09-27T01:00:00.000Z"],
          ["a", "2026-09-27T04:30:00.000Z", "2026-09-27T04:40:00.000Z"],
        ]);
        // When
        yield* printBreakdown(
          {
            range: { from: "2026-09-26T17:45", to: "2026-09-26T21:45" },
            block: "15min",
            groupBy: ["app"],
          },
          false,
        );
      }),
    );
    // Then
    expect(output).toEqual([
      "2026-09-26 17:45 to 21:45 · America/Los_Angeles · by app · per 15min",
      "17:45–18:00   first 17:50 · last 18:00",
      "10m 00s  Code",
      "10m 00s  total",
      "",
      "18:00–21:30   no activity",
      "",
      "21:30–21:45   first 21:30 · last 21:40",
      "10m 00s  Code",
      "10m 00s  total",
    ]);
  });

  it("a bad --block stops with core's message", async () => {
    // Given: seedBreakdown
    const { exit } = await runPrint(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* seedBreakdown(store);
        // When
        yield* printBreakdown({ range: day, block: "5min" } as never, false);
      }),
    );
    // Then
    expect(failure(exit)).toBe("block: must be one of total, hour, 15min");
  });

  it("a clock hour that repeats when DST ends shows its offset", () => {
    // Given: hour Blocks on 2026-11-01 in Los Angeles, color off
    const look = { color: false, unicode: true, width: 0 };
    // When
    const lines = blocksScreen(
      [
        {
          start: "2026-11-01T00:00-07:00",
          end: "2026-11-01T01:00-07:00",
          first: "2026-11-01T00:10-07:00",
          last: "2026-11-01T00:50-07:00",
          seconds: 2400,
          nodes: [{ name: "Code", seconds: 2400, children: [] }],
        },
        {
          start: "2026-11-01T01:00-07:00",
          end: "2026-11-01T01:00-08:00",
          first: "2026-11-01T01:03-07:00",
          last: "2026-11-01T01:58-07:00",
          seconds: 3300,
          nodes: [{ name: "Code", seconds: 3300, children: [] }],
        },
        {
          start: "2026-11-01T01:00-08:00",
          end: "2026-11-01T02:00-08:00",
          first: "2026-11-01T01:00-08:00",
          last: "2026-11-01T01:40-08:00",
          seconds: 2400,
          nodes: [{ name: "Code", seconds: 2400, children: [] }],
        },
      ],
      look,
    );
    // Then
    expect(lines).toEqual([
      "00:00–01:00   first 00:10 · last 00:50",
      "40m 00s  Code",
      "40m 00s  total",
      "",
      "01:00–02:00 -07:00   first 01:03 · last 01:58",
      "55m 00s  Code",
      "55m 00s  total",
      "",
      "01:00–02:00 -08:00   first 01:00 · last 01:40",
      "40m 00s  Code",
      "40m 00s  total",
    ]);
  });
});
