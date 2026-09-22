import { DateTime, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  clock,
  colorEnabled,
  columns,
  count,
  duration,
  line,
  mark,
  shortDuration,
  shortPath,
  text,
  unicodeEnabled,
} from "../src/format.js";

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
      mark("ok", { color: false, unicode: false }).text,
      mark("warn", { color: false, unicode: false }).text,
      mark("bad", { color: false, unicode: false }).text,
    ]).toEqual([false, true, true, "ok", "--", "x"]);
  });

  it("a painted mark carries the green bytes when color is on", () => {
    // Given
    const color = { color: true, unicode: true };
    // When / Then
    expect(line([mark("ok", color), " running"], color)).toBe(
      "\u001b[0;32m✔\u001b[0m running",
    );
  });

  it("a painted mark is the bare glyph when color is off", () => {
    // Given
    const plain = { color: false, unicode: true };
    // When / Then
    expect(line([mark("ok", plain), " running"], plain)).toBe("✔ running");
  });

  it("columns pad every column but the last to its widest cell plus two", () => {
    // Given
    const plain = { color: false, unicode: true };
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
    const color = { color: true, unicode: true };
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
