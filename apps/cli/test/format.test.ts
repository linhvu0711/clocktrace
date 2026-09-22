import { ConfigProvider, DateTime, Effect, Layer, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  clock,
  colorEnabled,
  columns,
  count,
  duration,
  line,
  mark,
  Style,
  shortDuration,
  shortPath,
  span,
  text,
  unicodeEnabled,
} from "../src/format.js";
import * as MockTerminal from "./mock-terminal.js";

describe("format", () => {
  it("color is off when stdout is not a terminal", () => {
    // Given / When / Then
    expect(colorEnabled(false, Option.none())).toBe(false);
  });

  it("color is off when NO_COLOR is set on a terminal", () => {
    // Given / When / Then
    expect(colorEnabled(true, Option.some("1"))).toBe(false);
  });

  it("color is on for a terminal when NO_COLOR is unset or empty", () => {
    // Given / When / Then
    expect([
      colorEnabled(true, Option.none()),
      colorEnabled(true, Option.some("")),
    ]).toEqual([true, true]);
  });

  it("marks fall back to ASCII only on the Linux console", () => {
    // Given / When / Then
    expect([
      unicodeEnabled(Option.some("linux")),
      unicodeEnabled(Option.some("xterm-256color")),
      unicodeEnabled(Option.none()),
      mark("ok", { color: false, unicode: false, width: 0 }).text,
      mark("warn", { color: false, unicode: false, width: 0 }).text,
      mark("bad", { color: false, unicode: false, width: 0 }).text,
    ]).toEqual([false, true, true, "ok", "--", "x"]);
  });

  it("a painted mark carries the green bytes when color is on", () => {
    // Given
    const color = { color: true, unicode: true, width: 0 };
    // When / Then
    expect(line([mark("ok", color), " running"], color)).toBe(
      "\u001b[0;32m✔\u001b[0m running",
    );
  });

  it("a painted mark is the bare glyph when color is off", () => {
    // Given
    const plain = { color: false, unicode: true, width: 0 };
    // When / Then
    expect(line([mark("ok", plain), " running"], plain)).toBe("✔ running");
  });

  it("columns pad every column but the last to its widest cell plus two", () => {
    // Given
    const plain = { color: false, unicode: true, width: 0 };
    // When / Then
    expect(
      columns(
        [
          ["Collector", "x"],
          ["Last activity", "y"],
        ],
        plain,
      ),
    ).toEqual(["Collector      x", "Last activity  y"]);
  });

  it("columns measure the text, not the color bytes", () => {
    // Given
    const color = { color: true, unicode: true, width: 0 };
    // When / Then
    expect(
      columns(
        [
          [[mark("ok", color), " a"], "x"],
          ["bbbb", "y"],
        ],
        color,
      ),
    ).toEqual(["\u001b[0;32m✔\u001b[0m a   x", "bbbb  y"]);
  });

  it("columns align a wide-character cell with an ASCII one", () => {
    // Given
    const plain = { color: false, unicode: true, width: 0 };
    // When / Then
    expect(
      columns(
        [
          ["漢字", "then"],
          ["ab", "then"],
        ],
        plain,
      ),
    ).toEqual(["漢字  then", "ab    then"]);
  });

  it("columns align a cell with a combining mark", () => {
    // Given
    const plain = { color: false, unicode: true, width: 0 };
    // When / Then
    expect(
      columns(
        [
          ["éx", "then"],
          ["ab", "then"],
        ],
        plain,
      ),
    ).toEqual(["éx  then", "ab  then"]);
  });

  it("columns align a cell with an emoji ZWJ sequence", () => {
    // Given
    const plain = { color: false, unicode: true, width: 0 };
    // When / Then
    expect(
      columns(
        [
          ["👩‍👩‍👧‍👦", "then"],
          ["ab", "then"],
        ],
        plain,
      ),
    ).toEqual(["👩‍👩‍👧‍👦  then", "ab  then"]);
  });

  it("Style reads the terminal width into width", async () => {
    // Given: a terminal 80 columns wide
    const look = await Effect.runPromise(
      Effect.gen(function* () {
        const terminal = yield* MockTerminal.make(true);
        // When
        return yield* Style.pipe(
          Effect.provide(
            Style.DefaultWithoutDependencies.pipe(
              Layer.provide(terminal.layer),
            ),
          ),
        );
      }).pipe(Effect.withConfigProvider(ConfigProvider.fromMap(new Map()))),
    );
    // Then
    expect(look.width).toBe(80);
  });

  it("a row wider than the width cuts the last cell with …", () => {
    // Given
    const look = { color: false, unicode: true, width: 8 };
    // When / Then
    expect(columns([["ab", "cdefghij"]], look)).toEqual(["ab  cde…"]);
  });

  it("the ellipsis is ... when unicode is off", () => {
    // Given
    const look = { color: false, unicode: false, width: 8 };
    // When / Then
    expect(columns([["ab", "cdefghij"]], look)).toEqual(["ab  c..."]);
  });

  it("a cut never splits a wide character", () => {
    // Given
    const look = { color: false, unicode: true, width: 8 };
    // When / Then
    expect(columns([["ab", "漢字漢"]], look)).toEqual(["ab  漢…"]);
  });

  it("a cut never splits a grapheme", () => {
    // Given
    const look = { color: false, unicode: true, width: 8 };
    // When / Then
    expect(columns([["ab", "👩‍👩‍👧‍👦👩‍👩‍👧‍👦👩‍👩‍👧‍👦"]], look)).toEqual([
      "ab  👩‍👩‍👧‍👦…",
    ]);
  });

  it("a cut keeps the tone of the text it keeps", () => {
    // Given
    const look = { color: true, unicode: true, width: 7 };
    // When / Then
    expect(columns([["ab", [span("ok", "cd"), "efgh"]]], look)).toEqual([
      "ab  \u001b[0;32mcd\u001b[0m…",
    ]);
  });

  it("a row that fits is not cut", () => {
    // Given
    const look = { color: false, unicode: true, width: 8 };
    // When / Then
    expect(columns([["ab", "cdef"]], look)).toEqual(["ab  cdef"]);
  });

  it("room for only the ellipsis prints just …", () => {
    // Given
    const look = { color: false, unicode: true, width: 5 };
    // When / Then
    expect(columns([["ab", "cdef"]], look)).toEqual(["ab  …"]);
  });

  it("an ellipsis wider than the room is dropped", () => {
    // Given
    const look = { color: false, unicode: false, width: 5 };
    // When / Then
    expect(columns([["ab", "cdef"]], look)).toEqual(["ab  c"]);
  });

  it("width 0 prints a wide row in full", () => {
    // Given
    const look = { color: false, unicode: true, width: 0 };
    // When / Then
    expect(columns([["ab", "cdefghij"]], look)).toEqual(["ab  cdefghij"]);
  });

  it("no room leaves the last cell empty", () => {
    // Given
    const look = { color: false, unicode: true, width: 4 };
    // When / Then
    expect(columns([["abcdef", "x"]], look)).toEqual(["abcdef  "]);
  });

  it("a too-wide last cell wraps onto lines indented to its column", () => {
    // Given
    const look = { color: false, unicode: true, width: 9 };
    // When / Then
    expect(
      columns([["ab", "one two three"]], look, { overflow: "wrap" }),
    ).toEqual(["ab  one", "    two", "    three"]);
  });

  it("a space-less token longer than the width hard-breaks", () => {
    // Given
    const look = { color: false, unicode: true, width: 9 };
    // When / Then
    expect(
      columns([["ab", "abcdefghijk"]], look, { overflow: "wrap" }),
    ).toEqual(["ab  abcde", "    fghij", "    k"]);
  });

  it("a wrapped cell keeps its tone on every line", () => {
    // Given
    const look = { color: true, unicode: true, width: 7 };
    // When / Then
    expect(
      columns([["ab", [span("dim", "one two")]]], look, { overflow: "wrap" }),
    ).toEqual(["ab  \u001b[0;90mone\u001b[0m", "    \u001b[0;90mtwo\u001b[0m"]);
  });

  it("a cell that fits is not wrapped", () => {
    // Given
    const look = { color: false, unicode: true, width: 9 };
    // When / Then
    expect(columns([["ab", "one"]], look, { overflow: "wrap" })).toEqual([
      "ab  one",
    ]);
  });

  it("wrap with width 0 prints the row in full", () => {
    // Given
    const look = { color: false, unicode: true, width: 0 };
    // When / Then
    expect(
      columns([["ab", "one two three"]], look, { overflow: "wrap" }),
    ).toEqual(["ab  one two three"]);
  });

  it("wrap with no room leaves the last cell empty", () => {
    // Given
    const look = { color: false, unicode: true, width: 4 };
    // When / Then
    expect(columns([["abcdef", "x"]], look, { overflow: "wrap" })).toEqual([
      "abcdef  ",
    ]);
  });

  it("shortPath puts ~ in place of the home folder at a path boundary", () => {
    // Given / When / Then
    expect([
      shortPath("/Users/ada/clocktrace-test/clocktrace.db", "/Users/ada"),
      shortPath("/Users/adam/x.db", "/Users/ada"),
      shortPath("/Users/ada", "/Users/ada"),
      shortPath("/tmp/x.db", "/Users/ada"),
    ]).toEqual([
      "~/clocktrace-test/clocktrace.db",
      "/Users/adam/x.db",
      "~",
      "/tmp/x.db",
    ]);
  });

  it("clock prints today for a time on the current day", () => {
    // Given
    const now = DateTime.unsafeMakeZoned("2026-09-22T16:51:00Z", {
      timeZone: "America/Los_Angeles",
    });
    // When / Then
    expect(clock(DateTime.unsafeMake("2026-09-22T16:51:00Z"), now)).toBe(
      "today 09:51",
    );
  });

  it("clock prints the date for another day", () => {
    // Given
    const now = DateTime.unsafeMakeZoned("2026-09-22T16:51:00Z", {
      timeZone: "America/Los_Angeles",
    });
    // When / Then
    expect(clock(DateTime.unsafeMake("2026-09-22T01:02:00Z"), now)).toBe(
      "2026-09-21 18:02",
    );
  });

  it("shortDuration prints <1m, whole minutes, and hours with padded minutes", () => {
    // Given / When / Then
    expect([
      shortDuration(0),
      shortDuration(59),
      shortDuration(60),
      shortDuration(119),
      shortDuration(600),
      shortDuration(5400),
      shortDuration(3660),
    ]).toEqual(["<1m", "<1m", "1m", "1m", "10m", "1h 30m", "1h 01m"]);
  });

  it("duration prints <1m, minutes with padded seconds, and hours", () => {
    // Given / When / Then
    expect([
      duration(0),
      duration(59),
      duration(60),
      duration(932),
      duration(1325),
      duration(3932),
    ]).toEqual(["<1m", "<1m", "1m 00s", "15m 32s", "22m 05s", "1h 05m 32s"]);
  });

  it("count uses the singular at one", () => {
    // Given / When / Then
    expect(count(1, "rule", "rules")).toBe("1 rule");
  });

  it("count uses the plural otherwise", () => {
    // Given / When / Then
    expect(count(6, "category", "categories")).toBe("6 categories");
  });

  it("text replaces control characters with a space", () => {
    // Given / When / Then
    expect(text("a\nb\tc\r")).toBe("a b c ");
  });
});
